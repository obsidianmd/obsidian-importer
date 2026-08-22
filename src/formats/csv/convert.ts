import { applyTemplate, generateFrontmatter, sourceVariableExpression, TemplateConfig } from '../../template';
import { CSVRow } from './parse';

export interface ConvertedRow {
	title: string;
	location: string;
	content: string;
}

export function defaultTemplateConfig(headers: string[], sanitizeKey: (key: string) => string): TemplateConfig {
	const propertyNames = new Map<string, string>();
	const propertyValues = new Map<string, string>();

	for (const header of headers) {
		propertyNames.set(header, sanitizeKey(header));
		propertyValues.set(header, `{{${header}}}`);
	}

	return {
		titleTemplate: headers.length > 0 ? `{{${headers[0]}}}` : '',
		locationTemplate: '',
		bodyTemplate: '',
		propertyNames,
		propertyValues,
	};
}

/** Build the inline Markdown template shown before a CSV import. */
export function defaultNoteTemplate(headers: string[], sanitizeKey: (key: string) => string): string {
	const properties = headers
		.map(header => ({ header, property: sanitizeKey(header).trim() }))
		.filter(({ property }) => property.length > 0)
		.map(({ header, property }) => `${property}: {{${sourceVariableExpression(header)} | yaml}}`);

	return properties.length > 0
		? ['---', ...properties, '---'].join('\n')
		: '{{content}}';
}

export function sanitizeYAMLKey(key: string): string {
	return key.replace(/[^\w\s-]/g, '');
}

export function convertRow(row: CSVRow, config: TemplateConfig): ConvertedRow {
	const frontmatter = generateFrontmatter(row, config.propertyNames, config.propertyValues);
	const body = applyTemplate(config.bodyTemplate, row);

	let content = '';
	if (frontmatter) content += frontmatter + '\n\n';
	if (body) content += body;

	return {
		title: applyTemplate(config.titleTemplate, row),
		location: applyTemplate(config.locationTemplate, row),
		content,
	};
}
