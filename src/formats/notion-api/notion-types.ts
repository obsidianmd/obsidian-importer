import type { DatabaseObjectResponse, PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

export interface NotionDatabaseProperty {
	id: string;
	name: string;
	type: string;
	[key: string]: unknown;
}

export interface NotionSelectOption {
	id?: string;
	name: string;
	color?: string;
}

export interface NotionSelectProperty extends NotionDatabaseProperty {
	type: 'select';
	select: {
		options: NotionSelectOption[];
	};
}

export interface NotionMultiSelectProperty extends NotionDatabaseProperty {
	type: 'multi_select';
	multi_select: {
		options: NotionSelectOption[];
	};
}

export interface NotionStatusProperty extends NotionDatabaseProperty {
	type: 'status';
	status: {
		options: NotionSelectOption[];
		groups?: unknown[];
	};
}

export interface NotionFormulaProperty extends NotionDatabaseProperty {
	type: 'formula';
	formula: {
		expression?: string;
		[key: string]: unknown;
	};
}

export type NotionDatabasePropertyType =
	| NotionSelectProperty
	| NotionMultiSelectProperty
	| NotionStatusProperty
	| NotionFormulaProperty
	| NotionDatabaseProperty;

export type NotionDatabaseWithProperties = DatabaseObjectResponse & {
	properties: Record<string, NotionDatabasePropertyType>;
};

export function isDatabaseObject(obj: { object?: string }): obj is NotionDatabaseWithProperties {
	return obj.object === 'database' || obj.object === 'data_source';
}

export function isSelectProperty(prop: NotionDatabasePropertyType): prop is NotionSelectProperty {
	return prop.type === 'select' && 'select' in prop;
}

export function isMultiSelectProperty(prop: NotionDatabasePropertyType): prop is NotionMultiSelectProperty {
	return prop.type === 'multi_select' && 'multi_select' in prop;
}

export function isStatusProperty(prop: NotionDatabasePropertyType): prop is NotionStatusProperty {
	return prop.type === 'status' && 'status' in prop;
}

export function isFormulaProperty(prop: NotionDatabasePropertyType): prop is NotionFormulaProperty {
	return prop.type === 'formula' && 'formula' in prop;
}

export type BasePropertyType =
	| 'text'
	| 'number'
	| 'date'
	| 'checkbox'
	| 'select'
	| 'multi-select'
	| 'link'
	| 'file';

export interface BaseProperty {
	type: BasePropertyType;
	name: string;
	displayName?: string;
	options?: string[];
	format?: string;
}

export interface BaseFormula {
	name: string;
	displayName?: string;
	expression: string;
}

export type FilterOperator =
	| '='
	| '!='
	| '>'
	| '<'
	| '>='
	| '<='
	| 'contains'
	| 'not contains'
	| 'starts with'
	| 'ends with'
	| 'is empty'
	| 'is not empty';

export interface FilterCondition {
	property: string;
	operator: FilterOperator;
	value?: unknown;
}

export interface FilterGroup {
	and?: (string | FilterCondition | FilterGroup)[];
	or?: (string | FilterCondition | FilterGroup)[];
	not?: string | FilterCondition | FilterGroup;
}

export type BaseFilter = string | FilterCondition | FilterGroup;

export type BaseViewType = 'table' | 'list' | 'gallery' | 'board' | 'calendar';

export interface BaseView {
	name: string;
	type: BaseViewType;
	filters?: BaseFilter;
	sorts?: BaseSort[];
	groups?: BaseGroup[];
	columns?: BaseColumn[];
	properties?: Record<string, unknown>;
}

export interface BaseColumn {
	property: string;
	width?: number;
	visible?: boolean;
}

export interface BaseSort {
	property: string;
	direction: 'ascending' | 'descending';
}

export interface BaseGroup {
	property: string;
	direction?: 'ascending' | 'descending';
}

export interface BaseSchema {
	version?: string;
	filters?: BaseFilter;
	properties?: Record<string, BaseProperty>;
	formulas?: Record<string, BaseFormula>;
	views?: BaseView[];
}

export const PROPERTY_TYPE_MAPPINGS: Record<string, BasePropertyType> = {
	'title': 'text',
	'rich_text': 'text',
	'number': 'number',
	'select': 'select',
	'multi_select': 'multi-select',
	'status': 'select',
	'date': 'date',
	'people': 'text',
	'files': 'file',
	'checkbox': 'checkbox',
	'url': 'link',
	'email': 'link',
	'phone_number': 'text',
	'formula': 'text',
	'relation': 'link',
	'rollup': 'text',
	'created_time': 'date',
	'created_by': 'text',
	'last_edited_time': 'date',
	'last_edited_by': 'text',
	'unique_id': 'text',
};
