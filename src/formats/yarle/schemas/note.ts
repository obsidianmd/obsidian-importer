import { Resource, ResourceSchema } from './resource';
import * as v from 'valibot';
import { Task, TaskSchema } from './task';
import { ApplicationDataPlus, ApplicationDataPlusSchema } from './application-data';

export const NoteAttributesSchema: v.BaseSchema<NoteAttributes, NoteAttributes, v.BaseIssue<unknown>> = v.object({
	'subject-date': v.optional(v.string()),
	'latitude': v.optional(v.string()),
	'longitude': v.optional(v.string()),
	'altitude': v.optional(v.string()),
	'author': v.optional(v.string()),
	'source': v.optional(v.string()),
	'source-url': v.optional(v.string()),
	'source-application': v.optional(v.string()),
	'reminder-order': v.optional(v.string()),
	'reminder-time': v.optional(v.string()),
	'reminder-done-time': v.optional(v.string()),
	'place-name': v.optional(v.string()),
	'content-class': v.optional(v.string()),
	'application-data': v.optional(ApplicationDataPlusSchema),
});
export type NoteAttributes = {
	'subject-date'?: string;
	'latitude'?: string;
	'longitude'?: string;
	'altitude'?: string;
	'author'?: string;
	'source'?: string;
	'source-url'?: string;
	'source-application'?: string;
	'reminder-order'?: string;
	'reminder-time'?: string;
	'reminder-done-time'?: string;
	'place-name'?: string;
	'content-class'?: string;
	'application-data'?: ApplicationDataPlus;
};

export const NoteSchema = v.object({
	'title': v.string(),
	'content': v.string(),
	'created': v.optional(v.string()),
	'updated': v.optional(v.string()),
	'tag': v.optional(v.union([v.string(), v.array(v.string())])),
	'note-attributes': v.optional(NoteAttributesSchema),
	'task': v.optional(v.union([TaskSchema, v.array(TaskSchema)])),
	'resource': v.optional(v.union([ResourceSchema, v.array(ResourceSchema)])),
});
export type Note = {
	/**
	 * May not begin or end with whitespace, may not contain line endings or
 	 * Unicode control characters.  Must be between 1 and 255 characters.
	 */
	'title': string;

	/**
	 * May not be longer than 5242880 Unicode characters.
	 * The contents of this character block must be a valid ENML document, which
	 * must be validated against the ENML DTD upon import:
	 *   http://xml.evernote.com/pub/enml.dtd
	 */
	'content': string;
	/** Must contain a valid date and time, if present. */
	'created'?: string;
	/** Must contain a valid date and time, if present. */
	'updated'?: string;
	/**
	 * May not begin or end with whitespace, may not contain line endings, commas
	 *   or Unicode control characters.  Must be between 1 and 100 characters.
	 */
	'tag'?: string | string[];
	'note-attributes'?: NoteAttributes;
	'task'?: Task | Task[];
	'resource'?: Resource | Resource[];
};

