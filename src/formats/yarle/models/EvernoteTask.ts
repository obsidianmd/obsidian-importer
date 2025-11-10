import { moment } from 'obsidian';
import { Task } from '../schemas/task';

export enum EvernoteTaskStatus {
	Open = 'open',
	Closed = 'closed',
}

export interface EvernoteTask {
	created: Date;
	creator: string | undefined;
	lasteditor: string | undefined;
	notelevelid: string;
	sortweight: string;
	statusupdated: Date | undefined;
	taskflag: boolean;
	taskgroupnotelevelid: string;
	taskstatus: EvernoteTaskStatus;
	title: string;
	duedate: Date | undefined;
	reminderdate: Date[];
	updated: Date;
}

export const mapEvernoteTask = (pureTask: Task): EvernoteTask => {
	const reminders = [pureTask.reminder ?? []].flat();
	return {
		created: getDateFromProperty(pureTask.created),
		creator: pureTask.creator,
		lasteditor: pureTask.lasteditor,
		notelevelid: pureTask.notelevelid,
		sortweight: pureTask.sortweight,
		statusupdated: getDateFromPropertyOptional(pureTask.statusupdated),
		taskflag: pureTask.taskflag === 'true',
		taskgroupnotelevelid: pureTask.taskgroupnotelevelid,
		taskstatus: {
			open: EvernoteTaskStatus.Open,
			closed: EvernoteTaskStatus.Closed,
		}[pureTask.taskstatus],
		title: pureTask.title,
		duedate: getDateFromPropertyOptional(pureTask.duedate),
		reminderdate: reminders
			.map(reminder => getDateFromPropertyOptional(reminder.reminderdate))
			.filter((d) => d !== undefined),
		updated: getDateFromProperty(pureTask.updated),
	};
};

const getDateFromProperty = (property: string) => {
	return moment(property, 'YYYYMMDDThhmmssZ').toDate();
};
const getDateFromPropertyOptional = (property: string | undefined) => {
	return property
		? moment(property, 'YYYYMMDDThhmmssZ').toDate()
		: undefined;
};
