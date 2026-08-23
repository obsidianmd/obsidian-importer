// Logseq task conversion. Logseq tasks are bullets whose text starts with an
// uppercase workflow keyword (TODO/DOING/DONE/...). Scheduling, priority and
// time-tracking metadata live on the task line or on indented continuation
// lines. We render them into one of the supported Obsidian task formats.

import { logseqDateToISO } from './journals';
import { outsideMarkdownCode } from '../../markdown';

export type TaskFormat = 'plain' | 'tasks-emoji' | 'tasks-dataview';

interface TaskOptions {
	logbook?: 'keep' | 'drop';
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
		case 'NOW': return '/';
		default: return ' '; // TODO, LATER, WAITING, WAIT, IN-PROGRESS
	}
}

interface DateSpec { date: string, repeater?: string }

function parseDateSpec(inner: string): DateSpec {
	// Try ISO date first, then fall back to Logseq long-date format.
	const iso = inner.match(/\d{4}-\d{2}-\d{2}/)?.[0];
	const date = iso ?? (logseqDateToISO(inner.replace(/\[\[|\]\]/g, '').trim()) ?? '');
	const repeater = inner.match(/[.+]{1,2}\d+[ymwdh]/)?.[0];
	return { date, repeater };
}

function extractDate(value: string): string {
	let raw = value.trim();
	// D1: Logseq set-literal `#{...}`. Unwrap the first quoted token (if any)
	// and try to parse it as a date; otherwise treat the value as absent.
	const setLiteral = raw.match(/^#\{(.*)\}$/);
	if (setLiteral) {
		const quoted = setLiteral[1].match(/"([^"]*)"/);
		raw = quoted ? quoted[1] : '';
	}
	const clean = raw.replace(/\[\[|\]\]/g, '').trim();
	// Guard: template tokens ({{...}}) are not real dates.
	if (/\{\{/.test(clean)) return '';
	// Try ISO first, then Logseq long-date.
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
	return outsideMarkdownCode(content, segment => convertTaskSegment(segment, format, options));
}

function convertTaskSegment(content: string, format: TaskFormat, options: TaskOptions): string {
	const logbook = options.logbook ?? 'drop';

	// D1: drop LOGBOOK drawers on ANY bullet (not just tasks) when logbook='drop'.
	// Use a line-level filter so no trailing newlines are left behind.
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

		// Collect indented continuation lines that belong to this block.
		// D1: blank/whitespace-only lines between metadata props are consumed
		// (they're Logseq outline separators) — only a non-blank line that is a
		// sibling/parent bullet actually ends the continuation block.
		const continuation: string[] = [];
		let j = i + 1;
		while (j < lines.length) {
			const l = lines[j];
			if (l.trim() === '') {
				// Peek at the next non-blank line to decide whether to continue.
				const peek = lines.slice(j + 1).find(x => x.trim() !== '');
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

		// Priority marker, e.g. `[#A]` right after the state.
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

		for (const cl of continuation) {
			if (inLogbook) {
				if (/:END:/.test(cl)) {
					inLogbook = false;
					if (logbook === 'keep') kept.push(cl);
				}
				else if (logbook === 'keep') kept.push(cl);
				continue;
			}
			if (/^\s*:LOGBOOK:/.test(cl)) {
				inLogbook = true;
				if (logbook === 'keep') kept.push(cl);
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
			const prop = cl.match(/^\s*(created|completed|done|cancelled|canceled):: ?(.*)$/);
			if (prop) {
				const date = extractDate(prop[2]);
				if (prop[1] === 'created') created = date;
				else if (prop[1] === 'completed' || prop[1] === 'done') done = date;
				else cancelled = date;
				continue;
			}
			// Blank separator lines between metadata are silently consumed.
			if (cl.trim() !== '') kept.push(cl);
		}

		// Build trailing metadata segments.
		const segs: string[] = [];
		if (format === 'tasks-emoji') {
			if (priority) segs.push(PRIORITY_EMOJI[priority]);
			if (scheduled?.date) {
				segs.push(`⏳ ${scheduled.date}`);
				if (scheduled.repeater) segs.push(formatRepeaterEmoji(scheduled.repeater));
			}
			if (deadline?.date) {
				segs.push(`📅 ${deadline.date}`);
				if (deadline.repeater) segs.push(formatRepeaterEmoji(deadline.repeater));
			}
			if (created) segs.push(`➕ ${created}`);
			if (done) segs.push(`✅ ${done}`);
			if (cancelled) segs.push(`❌ ${cancelled}`);
		}
		else if (format === 'tasks-dataview') {
			if (priority) segs.push(`[priority:: ${PRIORITY_WORD[priority]}]`);
			if (scheduled?.date) {
				segs.push(`[scheduled:: ${scheduled.date}]`);
				if (scheduled.repeater) segs.push(`[repeat:: ${scheduled.repeater}]`);
			}
			if (deadline?.date) {
				segs.push(`[due:: ${deadline.date}]`);
				if (deadline.repeater) segs.push(`[repeat:: ${deadline.repeater}]`);
			}
			if (created) segs.push(`[created:: ${created}]`);
			if (done) segs.push(`[completion:: ${done}]`);
			if (cancelled) segs.push(`[cancelled:: ${cancelled}]`);
		}

		const text = rest.trim();
		let taskLine = text ? `${indent}- [${checkbox(state, format)}] ${text}` : `${indent}- [${checkbox(state, format)}]`;
		if (segs.length) taskLine += ' ' + segs.join(' ');

		out.push(taskLine);
		out.push(...kept);
		i = j;
	}

	return out.join('\n');
}
