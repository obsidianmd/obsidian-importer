import * as v from 'valibot';
import { ApplicationDataPlus, ApplicationDataPlusSchema } from './application-data';

export const ResourceAttributesSchema: v.BaseSchema<ResourceAttributes, ResourceAttributes, v.BaseIssue<unknown>> = v.object({
	'source-url': v.optional(v.string()),
	'timestamp': v.optional(v.string()),
	'latitude': v.optional(v.string()),
	'longitude': v.optional(v.string()),
	'altitude': v.optional(v.string()),
	'camera-make': v.optional(v.string()),
	'camera-model': v.optional(v.string()),
	'reco-type': v.optional(v.string()),
	'file-name': v.optional(v.string()),
	'attachment': v.optional(v.string()),
	'application-data': v.optional(ApplicationDataPlusSchema),
});
export interface ResourceAttributes {
	'source-url'?: string;
	'timestamp'?: string;
	'latitude'?: string;
	'longitude'?: string;
	'altitude'?: string;
	'camera-make'?: string;
	'camera-model'?: string;
	'reco-type'?: string;
	'file-name'?: string;
	'attachment'?: string;
	'application-data'?: ApplicationDataPlus;
}

export const ResourceSchema: v.BaseSchema<Resource, Resource, v.BaseIssue<unknown>> = v.object({
	'data': v.union([
		v.string(),
		v.object({
			'$attrs': v.object({ 'encoding': v.string() }),
			'$text': v.string(),
		}),
	]),
	'mime': v.string(),
	'width': v.optional(v.string()),
	'height': v.optional(v.string()),
	'duration': v.optional(v.string()),
	'recognition': v.optional(v.string()),
	'resource-attributes': v.optional(ResourceAttributesSchema),
	'alternate-data': v.optional(v.union([
		v.string(),
		v.object({
			'$attrs': v.object({ 'encoding': v.string() }),
			'$text': v.string(),
		}),
	])),
});
export interface Resource {
	/**
	 * The binary body of the resource must be encoded into Base-64 format.  The
	 * encoding may contain whitespace (e.g. to break into lines), or may be
	 * continuous without break.  Total length of the original binary body may not
	 * exceed 25MB.
	 */
	'data': string | {
		'$attrs': { 'encoding': string };
		'$text': string;
	};
	'mime': string;
	'width'?: string;
	'height'?: string;
	'duration'?: string;
	'recognition'?: string;
	'resource-attributes'?: ResourceAttributes;
	'alternate-data'?: string | {
		'$attrs': { 'encoding': string };
		'$text': string;
	};
}
