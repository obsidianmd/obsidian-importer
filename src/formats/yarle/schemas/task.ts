import * as v from 'valibot';

export const ReminderSchema: v.BaseSchema<Reminder, Reminder, v.BaseIssue<unknown>> = v.object({
	'created': v.string(),
	'updated': v.string(),
	'notelevelid': v.string(),
	'reminderdate': v.optional(v.string()),
	'reminderdateuioption': v.optional(v.string()),
	'timezone': v.optional(v.string()),
	'duedateoffset': v.optional(v.string()),
	'reminderstatus': v.optional(v.string()),
});
export type Reminder = {
	'created': string;
	'updated': string;
	'notelevelid': string;
	'reminderdate'?: string;
	'reminderdateuioption'?: string;
	'timezone'?: string;
	'duedateoffset'?: string;
	'reminderstatus'?: string;
};

export const TaskSchema: v.BaseSchema<Task, Task, v.BaseIssue<unknown>> = v.object({
	'title': v.string(),
	'created': v.string(),
	'updated': v.string(),
	'taskstatus': v.picklist(['open', 'closed']),
	'innote': v.string(),
	'taskflag': v.string(),
	'sortweight': v.string(),
	'notelevelid': v.string(),
	'taskgroupnotelevelid': v.string(),
	'duedate': v.optional(v.string()),
	'duedateuioption': v.optional(v.string()),
	'timezone': v.optional(v.string()),
	'recurrence': v.optional(v.string()),
	'repeataftercompletion': v.optional(v.string()),
	'statusupdated': v.optional(v.string()),
	'creator': v.optional(v.string()),
	'lasteditor': v.optional(v.string()),
	'reminder': v.optional(v.union([ReminderSchema, v.array(ReminderSchema)])),
});
export type Task = {
	'title': string;
	'created': string;
	'updated': string;
	'taskstatus': 'open' | 'closed';
	'innote': string;
	'taskflag': string;
	'sortweight': string;
	'notelevelid': string;
	'taskgroupnotelevelid': string;
	'duedate'?: string;
	'duedateuioption'?: string;
	'timezone'?: string;
	'recurrence'?: string;
	'repeataftercompletion'?: string;
	'statusupdated'?: string;
	'creator'?: string;
	'lasteditor'?: string;
	'reminder'?: Reminder | Reminder[];
};
