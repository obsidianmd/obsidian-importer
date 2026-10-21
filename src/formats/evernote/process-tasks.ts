import { moment } from 'obsidian';
import { EvernoteTask } from './models/EvernoteTask';
import { getTaskStatusMd } from './utils/get-task-status-md';

import { EvernoteRun } from './run';

const MEDIUM_PRIORITY_ICON = '🔼';
const LOW_PRIORITY_ICON = '🔽';
const DUE_DATE_ICON = '📅';
const SCHEDULE_DATE_ICON = '⏳';

export const convertTasktoMd = (run: EvernoteRun, task: EvernoteTask): string => {
	const taskStatusMd = getTaskStatusMd(task);
	const title = task.title ? ` ${task.title}` : '';
	const tag = run.options.obsidianTaskTag !== '' ? ` ${run.options.obsidianTaskTag}` : '';
	const duedate = task.duedate && !isNaN(task.duedate.getTime())
		? ` ${DUE_DATE_ICON} ${convertDateFormat(task.duedate)}`
		: '';
	const reminder = task.reminderdate ? ` ${SCHEDULE_DATE_ICON} ${convertDateFormat(task.reminderdate)}` : '';

	const priority = task.taskflag ? ` ${MEDIUM_PRIORITY_ICON}` : ` ${LOW_PRIORITY_ICON}`;

	return `${taskStatusMd}${tag}${title}${duedate}${reminder}${priority}`;
};

const TASK_GROUP = /(\n*)<ENEX-EN-V10-TASK>(.*?)<\/ENEX-EN-V10-TASK>(\n*)/g;

/** Writes tasks where their group sits; tasks whose group is missing from the note go first. */
export const placeTasks = (run: EvernoteRun, markdown: string, tasks: EvernoteTask[]): string => {
	const sorted = [...tasks].sort((a, b) => compareWeights(a.sortweight ?? '', b.sortweight ?? ''));
	const lines = (group: EvernoteTask[]) => group.map(task => convertTasktoMd(run, task)).join('\n');
	const placed = new Set<string>();

	const body = markdown.replace(TASK_GROUP, (match, before: string, id: string, after: string, offset: number, whole: string) => {
		const group = placed.has(id) ? [] : sorted.filter(task => task.taskgroupnotelevelid === id);
		placed.add(id);

		if (group.length > 0) return before + lines(group) + after;
		if (offset === 0 || offset + match.length === whole.length) return '';
		return before.length > after.length ? before : after;
	});

	const orphans = sorted.filter(task => !placed.has(task.taskgroupnotelevelid));
	if (orphans.length === 0) return body;

	return body ? `${lines(orphans)}\n\n${body}` : lines(orphans);
};

const compareWeights = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const convertDateFormat = (dateProp: Date): string => {
	return moment(dateProp).format('YYYY-MM-DD').toString();
};
