import * as v from 'valibot';

export const ApplicationDataSchema: v.BaseSchema<ApplicationData, ApplicationData, v.BaseIssue<unknown>> = v.object({
	'$attrs': v.object({ 'key': v.string() }),
	'$text': v.string(),
});
export type ApplicationData = {
	'$attrs': { 'key': string };
	'$text': string;
};
export const ApplicationDataPlusSchema = v.union([ApplicationDataSchema, v.array(ApplicationDataSchema)]);
export type ApplicationDataPlus = ApplicationData | ApplicationData[];
