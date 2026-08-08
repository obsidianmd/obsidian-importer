import { applyTemplate, generateFrontmatter, TemplateConfig } from '../../template';
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
