import { logseqDateToISO } from './journals';
import { BLOCK_ANCHOR_PATTERN, nextNonBlankLine, outsideCodeSpans, outsideMarkdownFences } from '../../markdown';

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
const TRAILING_BLOCK_ANCHOR = new RegExp(`(?:^|\\s)(${BLOCK_ANCHOR_PATTERN})\\s*$`);

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

function parseDateSpec(inner: string): DateSpec | null {
	const iso = inner.match(/\d{4}-\d{2}-\d{2}/)?.[0];
	const date = iso ?? (logseqDateToISO(inner.replace(/\[\[|\]\]/g, '').trim()) ?? '');
	if (!date) return null;
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

function dateLink(date: string, time?: string): string {
	if (!date) return '';
	return time ? `[[${date}]] ${time}` : `[[${date}]]`;
}

function dateDetail(label: string, spec: DateSpec): string {
	let detail = `${label} ${dateLink(spec.date, spec.time)}`;
	if (spec.repeater) {
		const phrase = repeatPhrase(spec.repeater);
		detail += phrase ? ` ${phrase} (${spec.repeater})` : ` (${spec.repeater})`;
	}
	return detail;
}

export function convertTasks(content: string, keepTimeTracking = false): string {
	return outsideMarkdownFences(content, segment => convertTaskSegment(segment, keepTimeTracking));
}

function convertTaskSegment(content: string, keepTimeTracking: boolean): string {
	let processed = content;
	if (!keepTimeTracking) {
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
				(whole: string, keyword: string, inner: string) => {
					const parsed = parseDateSpec(inner);
					if (!parsed) return whole;
					if (keyword === 'SCHEDULED') scheduled = parsed;
					else deadline = parsed;
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
				const parsed = parseDateSpec(sched[1]);
				if (parsed) scheduled = parsed;
				else kept.push(cl);
				continue;
			}
			const dead = cl.match(/^\s*DEADLINE:\s*<(.+?)>/);
			if (dead) {
				const parsed = parseDateSpec(dead[1]);
				if (parsed) deadline = parsed;
				else kept.push(cl);
				continue;
			}
			const prop = cl.match(/^\s*\.?(created|completed|done|cancelled|canceled):: ?(.*)$/);
			if (prop) {
				const date = extractDate(prop[2]);
				if (!date) {
					kept.push(cl);
					continue;
				}
				if (prop[1] === 'created') created = date;
				else if (prop[1] === 'completed' || prop[1] === 'done') done = date;
				else cancelled = date;
				continue;
			}
			if (cl.trim() !== '') kept.push(cl);
		}

		const details: string[] = [];
		if (priority) details.push(`priority ${priority}`);
		if (scheduled) details.push(dateDetail('scheduled', scheduled));
		if (deadline) details.push(dateDetail('due', deadline));
		if (created) details.push(`created ${dateLink(created)}`);
		if (done) details.push(`completed ${dateLink(done)}`);
		if (cancelled) details.push(`cancelled ${dateLink(cancelled)}`);

		const anchorMatch = rest.match(TRAILING_BLOCK_ANCHOR);
		const anchor = anchorMatch?.[1] ?? '';
		if (anchorMatch) rest = rest.slice(0, anchorMatch.index).trimEnd();
		const text = [rest.trim(), details.join(', ')].filter(Boolean).join(' — ');
		let task = text ? `${indent}- [${checkbox(state)}] ${text}` : `${indent}- [${checkbox(state)}]`;
		if (anchor) task += ` ${anchor}`;
		out.push(task);
		out.push(...kept);
		i = j;
	}

	return out.join('\n');
}
