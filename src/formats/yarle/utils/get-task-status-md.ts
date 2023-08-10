import { checkboxDone, checkboxTodo } from '../constants';
import { EvernoteTaskStatus } from '../models/EvernoteTask';

export const getTaskStatusMd = (task: any): string => {
	return (task.taskstatus === EvernoteTaskStatus.Open)
		? checkboxTodo
		: checkboxDone;
};
