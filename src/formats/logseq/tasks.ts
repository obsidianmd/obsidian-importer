import { outsideMarkdownFences } from '../../markdown';
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

export function convertTasks(content: string, options: TaskOptions = {}): string {
	return outsideMarkdownFences(content, segment => convertTaskSegment(segment, options));
}

function convertTaskSegment(content: string, options: TaskOptions): string {
	const logbook = options.logbook ?? 'drop';
	let inLogbook = false;

	return content
		.split('\n')
		.filter(line => {
			if (logbook === 'keep') return true;
			if (/^\s*:LOGBOOK:/.test(line)) {
				inLogbook = true;
				return false;
			}
			if (inLogbook && /:END:/.test(line)) {
				inLogbook = false;
				return false;
			}
			return !inLogbook;
		})
		.map(line => {
			const match = line.match(TASK_RE);
			if (!match) return line;
			const [, indent, state, text = ''] = match;
			return text ? `${indent}- [${checkbox(state)}] ${text}` : `${indent}- [${checkbox(state)}]`;
		})
		.join('\n');
}
