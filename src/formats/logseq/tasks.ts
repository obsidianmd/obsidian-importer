import { logseqDateToISO } from './journals';
import { nextNonBlankLine, outsideCodeSpans, outsideMarkdownFences } from '../../markdown';
import { KeepOrDrop, TaskFormat } from './options';

export type { TaskFormat };

interface TaskOptions {
	logbook?: KeepOrDrop;
}

const KEYWORDS = ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING', 'WAIT', 'IN-PROGRESS', 'CANCELLED', 'CANCELED'];
const TASK_RE = new RegExp(`^(\\s*)- (${KEYWORDS.join('|')}):?(?:\\s+(.*))?$`);

function checkbox(state: string, format: TaskFormat): string {
	const done = state === 'DONE' || state === 'CANCELLED' || state === 'CANCELED';
	if (format === 'plain') return done ? 'x' : ' ';
	switch (state) {
		case 'DONE': return 'x';
		case 'CANCELLED':
		case 'CANCELED': return '-';
		case 'DOING':
		case 'NOW':
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

function renderedDate(spec: DateSpec): string {
	return spec.time ? `${spec.date} ${spec.time}` : spec.date;
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

const UNIT_WORDS: Record<string, string> = { y: 'year', m: 'month', w: 'week', d: 'day', h: 'hour' };

function formatRepeaterEmoji(repeater: string): string {
	const m = repeater.match(/^([.+]{1,2})(\d+)([ymwdh])$/);
	if (!m) return '';
	const [, prefix, nStr, unit] = m;
	const n = parseInt(nStr, 10);
	const word = UNIT_WORDS[unit];
	const base = n === 1 ? `every ${word}` : `every ${n} ${word}s`;
	const whenDone = prefix === '.+' || prefix === '++';
	return `🔁 ${base}${whenDone ? ' when done' : ''}`;
}

const PRIORITY_EMOJI: Record<string, string> = { A: '⏫', B: '🔼', C: '🔽' };
const PRIORITY_WORD: Record<string, string> = { A: 'high', B: 'medium', C: 'low' };

function leadingWidth(line: string): number {
	return (line.match(/^\s*/)?.[0] ?? '').length;
}

export function convertTasks(content: string, format: TaskFormat, options: TaskOptions = {}): string {
	return outsideMarkdownFences(content, segment => convertTaskSegment(segment, format, options));
}

function convertTaskSegment(content: string, format: TaskFormat, options: TaskOptions): string {
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
			if (inLogbook) return false;
			return true;
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
		if (format !== 'plain') {
			const pm = rest.match(/^\[#([ABC])\]\s*/);
			if (pm) {
				priority = pm[1];
				rest = rest.slice(pm[0].length);
			}
		}

		const kept: string[] = [];
		let scheduled: DateSpec | undefined;
		let deadline: DateSpec | undefined;
		let created = '';
		let done = '';
		let cancelled = '';
		let inLogbook = false;

		// Continuation metadata, Logseq's canonical form, overrides inline metadata.
		if (format !== 'plain') {
			rest = outsideCodeSpans(rest, segment =>
				segment.replace(/\s*\b(SCHEDULED|DEADLINE):\s*<([^<>]+)>/g,
					(_, keyword: string, inner: string) => {
						if (keyword === 'SCHEDULED') scheduled = parseDateSpec(inner);
						else deadline = parseDateSpec(inner);
						return '';
					}));
		}

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
			if (format === 'plain') {
				if (cl.trim() !== '') kept.push(cl);
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

		const segs: string[] = [];
		if (format === 'tasks-emoji') {
			if (priority) segs.push(PRIORITY_EMOJI[priority]);
			if (scheduled?.date) {
				segs.push(`⏳ ${renderedDate(scheduled)}`);
				if (scheduled.repeater) segs.push(formatRepeaterEmoji(scheduled.repeater));
			}
			if (deadline?.date) {
				segs.push(`📅 ${renderedDate(deadline)}`);
				if (deadline.repeater) segs.push(formatRepeaterEmoji(deadline.repeater));
			}
			if (created) segs.push(`➕ ${created}`);
			if (done) segs.push(`✅ ${done}`);
			if (cancelled) segs.push(`❌ ${cancelled}`);
		}
		else if (format === 'tasks-dataview') {
			if (priority) segs.push(`[priority:: ${PRIORITY_WORD[priority]}]`);
			if (scheduled?.date) {
				segs.push(`[scheduled:: ${renderedDate(scheduled)}]`);
				if (scheduled.repeater) segs.push(`[repeat:: ${scheduled.repeater}]`);
			}
			if (deadline?.date) {
				segs.push(`[due:: ${renderedDate(deadline)}]`);
				if (deadline.repeater) segs.push(`[repeat:: ${deadline.repeater}]`);
			}
			if (created) segs.push(`[created:: ${created}]`);
			if (done) segs.push(`[completion:: ${done}]`);
			if (cancelled) segs.push(`[cancelled:: ${cancelled}]`);
		}

		// Obsidian block anchors must remain last.
		let anchor = '';
		if (format !== 'plain') {
			const anchored = rest.match(/(?:^|\s)(\^[A-Za-z0-9_-]+)\s*$/);
			if (anchored) {
				anchor = anchored[1];
				rest = rest.slice(0, anchored.index).trimEnd();
			}
		}

		const text = rest.trim();
		let taskLine = text ? `${indent}- [${checkbox(state, format)}] ${text}` : `${indent}- [${checkbox(state, format)}]`;
		if (segs.length) taskLine += ' ' + segs.join(' ');
		if (anchor) taskLine += ' ' + anchor;

		out.push(taskLine);
		out.push(...kept);
		i = j;
	}

	return out.join('\n');
}
