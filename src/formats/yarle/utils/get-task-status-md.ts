import { checkboxDone, checkboxTodo } from '../constants';
import { EvernoteTask, EvernoteTaskStatus } from '../models/EvernoteTask';

export const getTaskStatusMd = (task: EvernoteTask): string => {
	return (task.taskstatus === EvernoteTaskStatus.Open)
		? checkboxTodo
		: checkboxDone;
};
