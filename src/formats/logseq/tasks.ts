import { logseqDateToISO } from './journals';
import { nextNonBlankLine, outsideCodeSpans, outsideMarkdownFences } from '../../markdown';
import { KeepOrDrop } from './options';

interface TaskOptions {
	logbook?: KeepOrDrop;
}

const KEYWORDS = [
	'TODO',
	'DOING',
	'DONE',
	'LATER',
	'NOW',
	'WAITING',
	'WAIT',
	'STARTED',
	'IN-PROGRESS',
	'CANCELLED',
	'CANCELED',
];
const TASK_RE = new RegExp(`^(\\s*)- (${KEYWORDS.join('|')}):?(?:\\s+(.*))?$`);

function checkbox(state: string): string {
	switch (state) {
		case 'DONE': return 'x';
		case 'CANCELLED':
		case 'CANCELED': return '-';
		case 'DOING':
		case 'NOW':
		case 'STARTED':
		case 'IN-PROGRESS': return '/';
		default: return ' ';
	}
}

interface DateSpec { date: string, time?: string, repeater?: string }

function parseDateSpec(inner: string): DateSpec {
	const iso = inner.match(/\d{4}-\d{2}-\d{2}/)?.[0];
	const date = iso ?? (logseqDateToISO(inner.replace(/\[\[|\]\]/g, '').trim()) ?? '');
	const time = inner.match(/(?:^|\s)([01]\d|2[0-3]):[0-5]\d(?:\s|$)/)?.[0].trim();
	const repeater = inner.match(/[.+]{1,2}\d+[ymwdh]/)?.[0];
	return { date, time, repeater };
}

function extractDate(value: string): string {
	let raw = value.trim();
	const setLiteral = raw.match(/^#\{(.*)\}$/);
	if (setLiteral) {
		const quoted = setLiteral[1].match(/"([^"]*)"/);
		raw = quoted ? quoted[1] : '';
	}
	const clean = raw.replace(/\[\[|\]\]/g, '').trim();
	if (/\{\{/.test(clean)) return '';
	return clean.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? logseqDateToISO(clean) ?? '';
}

function leadingWidth(line: string): number {
	return line.match(/^\s*/)?.[0].length ?? 0;
}

const UNIT_WORDS: Record<string, string> = { y: 'year', m: 'month', w: 'week', d: 'day', h: 'hour' };

function repeatPhrase(repeater: string): string {
	const m = repeater.match(/^[.+]{1,2}(\d+)([ymwdh])$/);
	if (!m) return '';
	const count = parseInt(m[1], 10);
	const unit = UNIT_WORDS[m[2]];
	if (!unit) return '';
	return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

/**
 * A date a plugin-less vault can still follow: the journal link the rest of the
 * import already repaths, rather than Logseq's `<...>` or a plugin's emoji.
 */
function dateLink(date: string, time?: string): string {
	if (!date) return '';
	return time ? `[[${date}]] ${time}` : `[[${date}]]`;
}

export function convertTasks(content: string, options: TaskOptions = {}): string {
	return outsideMarkdownFences(content, segment => convertTaskSegment(segment, options));
}

function convertTaskSegment(content: string, options: TaskOptions): string {
	const logbook = options.logbook ?? 'drop';

	let processed = content;
	if (logbook === 'drop') {
		let inLogbook = false;
		processed = content.split('\n').filter(line => {
			if (/^\s*:LOGBOOK:/.test(line)) {
				inLogbook = true;
				return false;
			}
			if (inLogbook && /:END:/.test(line)) {
				inLogbook = false;
				return false;
			}
			return !inLogbook;
		}).join('\n');
	}

	const lines = processed.split('\n');
	const out: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const m = line.match(TASK_RE);
		if (!m) {
			out.push(line);
			i++;
			continue;
		}

		const indent = m[1];
		const state = m[2];
		let rest = m[3] ?? '';

		// Blank separators do not end Logseq task metadata.
		const continuation: string[] = [];
		let j = i + 1;
		while (j < lines.length) {
			const l = lines[j];
			if (l.trim() === '') {
				const peek = nextNonBlankLine(lines, j + 1);
				if (peek === undefined) break;
				if (/^\s*- /.test(peek) && leadingWidth(peek) <= indent.length) break;
				if (leadingWidth(peek) > indent.length || !/^\s*- /.test(peek)) {
					continuation.push(l); j++; continue;
				}
				break;
			}
			if (/^\s*- /.test(l)) break;
			if (leadingWidth(l) <= indent.length) break;
			continuation.push(l);
			j++;
		}

		let priority = '';
		const pm = rest.match(/^\[#([ABC])\]\s*/);
		if (pm) {
			priority = pm[1];
			rest = rest.slice(pm[0].length);
		}

		const kept: string[] = [];
		let scheduled: DateSpec | undefined;
		let deadline: DateSpec | undefined;
		let created = '';
		let done = '';
		let cancelled = '';
		let inLogbook = false;

		// Continuation metadata, Logseq's canonical form, overrides inline metadata.
		rest = outsideCodeSpans(rest, segment =>
			segment.replace(/\s*\b(SCHEDULED|DEADLINE):\s*<([^<>]+)>/g,
				(_: string, keyword: string, inner: string) => {
					if (keyword === 'SCHEDULED') scheduled = parseDateSpec(inner);
					else deadline = parseDateSpec(inner);
					return '';
				}));

		// The pre-pass above already removed every logbook line when dropping,
		// so anything reaching here is being kept.
		for (const cl of continuation) {
			if (inLogbook) {
				if (/:END:/.test(cl)) inLogbook = false;
				kept.push(cl);
				continue;
			}
			if (/^\s*:LOGBOOK:/.test(cl)) {
				inLogbook = true;
				kept.push(cl);
				continue;
			}
			const sched = cl.match(/^\s*SCHEDULED:\s*<(.+?)>/);
			if (sched) {
				scheduled = parseDateSpec(sched[1]);
				continue;
			}
			const dead = cl.match(/^\s*DEADLINE:\s*<(.+?)>/);
			if (dead) {
				deadline = parseDateSpec(dead[1]);
				continue;
			}
			const prop = cl.match(/^\s*\.?(created|completed|done|cancelled|canceled):: ?(.*)$/);
			if (prop) {
				const date = extractDate(prop[2]);
				if (prop[1] === 'created') created = date;
				else if (prop[1] === 'completed' || prop[1] === 'done') done = date;
				else cancelled = date;
				continue;
			}
			if (cl.trim() !== '') kept.push(cl);
		}

		const details: string[] = [];
		if (priority) details.push(`priority ${priority}`);
		if (scheduled?.date) details.push(`scheduled ${dateLink(scheduled.date, scheduled.time)}`);
		if (deadline?.date) details.push(`due ${dateLink(deadline.date, deadline.time)}`);
		if (created) details.push(`created ${dateLink(created)}`);
		if (done) details.push(`completed ${dateLink(done)}`);
		if (cancelled) details.push(`cancelled ${dateLink(cancelled)}`);
		const repeat = repeatPhrase(scheduled?.repeater ?? deadline?.repeater ?? '');
		if (repeat) details.push(repeat);

		const text = [rest.trim(), details.join(', ')].filter(Boolean).join(' — ');
		out.push(text ? `${indent}- [${checkbox(state)}] ${text}` : `${indent}- [${checkbox(state)}]`);
		out.push(...kept);
		i = j;
	}

	return out.join('\n');
}
