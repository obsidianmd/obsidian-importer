/**
 * Turning a CSV row into a note, separate from the importer that writes it.
 *
 * Nothing here touches Obsidian or a vault: a row and a template configuration
 * go in, and the note's title, folder and markdown come out. Writing it is the
 * importer's job.
 */
import { applyTemplate, generateFrontmatter, TemplateConfig } from '../../template';
import { CSVRow } from './parse';

/** A note as the conversion produces it, before anything writes it down. */
export interface ConvertedRow {
	/** Unsanitised; the caller names the file through its own rules. */
	title: string;
	/** Relative to the import folder. Empty means the import folder itself. */
	location: string;
	/** Frontmatter and body, ready to write. */
	content: string;
}

/**
 * The configuration the importer offers before anything is edited: every
 * column becomes a property, and the first one names the note.
 *
 * Shared with the tests so they exercise what a user would get by default
 * rather than a configuration invented for them.
 */
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

/** Remove what YAML will not accept in a key. */
export function sanitizeYAMLKey(key: string): string {
	// Remove special characters that aren't valid in YAML keys
	return key.replace(/[^\w\s-]/g, '');
}

/** Build one note. A row with no title is the caller's to skip. */
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
