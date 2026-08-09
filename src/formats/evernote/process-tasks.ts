import { moment } from 'obsidian';
import { EvernoteTask } from './models/EvernoteTask';
import { getTaskStatusMd } from './utils/get-task-status-md';

import { evernoteOptions } from './convert';

const MEDIUM_PRIORITY_ICON = '🔼';
const LOW_PRIORITY_ICON = '🔽';
const DUE_DATE_ICON = '📅';
const SCHEDULE_DATE_ICON = '⏳';

export const convertTasktoMd = (task: EvernoteTask, notebookName: string): string => {
	const taskStatusMd = getTaskStatusMd(task);
	const title = task.title ? ` ${task.title}` : '';
	const tag = evernoteOptions.obsidianTaskTag !== '' ? ` ${evernoteOptions.obsidianTaskTag}` : '';
	const duedate = task.duedate && !isNaN(task.duedate.getTime())
		? ` ${DUE_DATE_ICON} ${convertDateFormat(task.duedate)}`
		: '';
	const reminder = task.reminderdate ? ` ${SCHEDULE_DATE_ICON} ${convertDateFormat(task.reminderdate)}` : '';

	const priority = task.taskflag ? ` ${MEDIUM_PRIORITY_ICON}` : ` ${LOW_PRIORITY_ICON}`;

	return `${taskStatusMd}${tag}${title}${duedate}${reminder}${priority}`;
};

const convertDateFormat = (dateProp: Date): string => {
	return moment(dateProp).format('YYYY-MM-DD').toString();
};
