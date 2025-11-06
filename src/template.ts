import { Notice, Setting, setIcon } from 'obsidian';

/**
 * Represents a field that can be used in templates.
 * Each field corresponds to a piece of data that can be inserted into templates using placeholder syntax.
 */
export interface TemplateField {
	/** Unique identifier for the field (used in placeholders like {{id}}) */
	id: string;
	/** Human-readable label for the field */
	label: string;
	/** Optional example value to show in the UI */
	exampleValue?: string;
}

/**
 * Configuration for how templates should be applied during import.
 */
export interface TemplateConfig {
	/** Template for generating note titles */
	titleTemplate: string;
	/** Template for generating note locations/paths */
	locationTemplate: string;
	/** Maps field IDs to property names in frontmatter */
	propertyNames: Map<string, string>;
	/** Maps field IDs to property value templates in frontmatter */
	propertyValues: Map<string, string>;
	/** Template for generating note body content */
	bodyTemplate: string;
}

/**
 * Options for configuring the template UI.
 */
export interface TemplateOptions {
	/** Available fields that can be used in templates */
	fields: TemplateField[];
	/** Default values for template fields */
	defaults?: Partial<TemplateConfig>;
	/** Description of placeholder syntax (e.g., "{{column_name}}") */
	placeholderSyntax?: string;
}

/**
 * Generic template configurator that can be used by any importer.
 * 
 * @example
 * ```ts
 * // Prepare fields from your data source
 * const fields: TemplateField[] = [
 *   { id: 'title', label: 'Title', exampleValue: 'My Note' },
 *   { id: 'date', label: 'Date', exampleValue: '2025-10-01' },
 *   { id: 'content', label: 'Content', exampleValue: 'Note content here...' }
 * ];
 * 
 * // Set up defaults
 * const configurator = new TemplateConfigurator({
 *   fields,
 *   defaults: {
 *     titleTemplate: '{{title}}',
 *     bodyTemplate: '{{content}}',
 *   },
 *   placeholderSyntax: '{{field_name}}'
 * });
 * 
 * // Show configuration UI and get user's choices
 * const config = await configurator.show(modal.contentEl, ctx);
 * if (!config) {
 *   // User cancelled
 *   return;
 * }
 * 
 * // Use the config to process your data
 * const title = applyTemplate(config.titleTemplate, dataRow);
 * const content = applyTemplate(config.bodyTemplate, dataRow);
 * ```
 */
export class TemplateConfigurator {
	private config: TemplateConfig;
	private fields: TemplateField[];
	private placeholderSyntax: string;

	constructor(options: TemplateOptions) {
		this.fields = options.fields;
		this.placeholderSyntax = options.placeholderSyntax || '{{field_name}}';

		// Initialize config with defaults
		this.config = {
			titleTemplate: options.defaults?.titleTemplate || '',
			locationTemplate: options.defaults?.locationTemplate || '',
			propertyNames: options.defaults?.propertyNames || new Map(),
			propertyValues: options.defaults?.propertyValues || new Map(),
			bodyTemplate: options.defaults?.bodyTemplate || '',
		};
	}

	/**
	 * Shows the template configuration UI and returns the user's configuration.
	 * @param container The container element to display the configuration UI in
	 * @returns The template configuration if user clicked Continue, null if cancelled
	 */
	async show(container: HTMLElement): Promise<TemplateConfig | null> {
		return new Promise((resolve) => {
			container.empty();

			container.createEl('p', {
				text: `Configure how your data should be imported. Use ${this.placeholderSyntax} syntax to reference field values.`,
			});

			// Note title template
			new Setting(container)
				.setName('Note title')
				.setDesc('Template for the note title. Use {{field_name}} to insert values.')
				.addText(text => text
					.setPlaceholder('{{Title}}')
					.setValue(this.config.titleTemplate)
					.onChange(value => {
						this.config.titleTemplate = value;
					}));

			// Note location template
			new Setting(container)
				.setName('Note location')
				.setDesc('Template for note location/path. Use {{field_name}} to organize notes.')
				.addText(text => text
					.setPlaceholder('{{Category}}/{{Subcategory}}')
					.setValue(this.config.locationTemplate)
					.onChange(value => {
						this.config.locationTemplate = value;
					}));

			// Column selection for frontmatter
			const headerContainer = container.createDiv({ cls: 'importer-frontmatter-header' });
			headerContainer.createEl('h4', { text: 'Properties' });

			const columnContainer = container.createDiv('importer-column-list');

			// Add header row
			const headerRow = columnContainer.createDiv('importer-column-header-row');
			headerRow.createDiv('importer-column-name-col').setText('Property name');
			headerRow.createDiv('importer-column-value-col').setText('Property value');
			headerRow.createDiv('importer-column-example-col').setText('Example');
			headerRow.createDiv('importer-column-delete-col'); // Empty space for delete button

			for (const field of this.fields) {
				const rowEl = columnContainer.createDiv('importer-column-row');

				// Property name input column
				const nameCol = rowEl.createDiv('importer-column-name-col');
				const nameInput = nameCol.createEl('input', {
					type: 'text',
					cls: 'importer-column-property',
					value: this.config.propertyNames.get(field.id) || ''
				});
				nameInput.addEventListener('input', () => {
					this.config.propertyNames.set(field.id, nameInput.value);
				});

				// Property value input column
				const valueCol = rowEl.createDiv('importer-column-value-col');
				const valueInput = valueCol.createEl('input', {
					type: 'text',
					cls: 'importer-column-property',
					value: this.config.propertyValues.get(field.id) || ''
				});
				valueInput.addEventListener('input', () => {
					this.config.propertyValues.set(field.id, valueInput.value);
				});

				// Example value column
				const exampleCol = rowEl.createDiv('importer-column-example-col');
				const exampleValue = field.exampleValue || '';
				const truncated = exampleValue.length > 50
					? exampleValue.substring(0, 50) + '...'
					: exampleValue;
				exampleCol.setText(truncated || '—');

				// Delete button column
				const deleteCol = rowEl.createDiv('importer-column-delete-col');
				const deleteButton = deleteCol.createEl('button', {
					cls: 'clickable-icon',
					attr: { 'aria-label': 'Delete property' }
				});
				setIcon(deleteButton, 'trash-2');
				deleteButton.addEventListener('click', () => {
					// Remove from configuration
					this.config.propertyNames.delete(field.id);
					this.config.propertyValues.delete(field.id);
					// Remove from UI
					rowEl.remove();
				});
			}

			// Note content template
			new Setting(container)
				.setName('Note content')
				.setDesc('Template for the note content. Use {{field_name}} to insert values.')
				.addTextArea(text => {
					text
						.setPlaceholder('{{Content}}')
						.setValue(this.config.bodyTemplate)
						.onChange(value => {
							this.config.bodyTemplate = value;
						});
					text.inputEl.rows = 6;
				});

			// Buttons
			const buttonContainer = container.createDiv('modal-button-container');
			buttonContainer.createEl('button', { cls: 'mod-cta', text: 'Continue' }, el => {
				el.addEventListener('click', () => {
					// Validate configuration
					if (!this.config.titleTemplate.trim()) {
						new Notice('Please provide a note title template.');
						return;
					}

					resolve(this.config);
				});
			});

			buttonContainer.createEl('button', { text: 'Cancel' }, el => {
				el.addEventListener('click', () => {
					resolve(null);
				});
			});
		});
	}
}

/**
 * Applies a template string to a data object, replacing {{fieldName}} placeholders with values.
 * 
 * @param template - Template string with {{fieldName}} placeholders
 * @param data - Object containing field values
 * @returns Processed string with placeholders replaced
 * 
 * @example
 * ```ts
 * const result = applyTemplate('Hello {{name}}!', { name: 'World' });
 * // Returns: "Hello World!"
 * ```
 */
export function applyTemplate(template: string, data: Record<string, string>): string {
	if (!template) return '';

	return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, fieldName) => {
		const trimmedName = fieldName.trim();
		return data[trimmedName] !== undefined ? data[trimmedName] : match;
	});
}

/**
 * Converts a string value to an appropriate YAML representation.
 * NOTE: Complex types like arrays and objects are not supported and are returned as strings.
 */
function convertToYAML(value: string): string {
	const lowerCaseValue = value.trim().toLowerCase();

	if (lowerCaseValue === 'null' || lowerCaseValue === 'undefined' || value === '') {
		return '';
	}

	if (lowerCaseValue === 'true' || lowerCaseValue === 'false') {
		return lowerCaseValue; // Boolean
	}

	if (!isNaN(Number(value))) {
		return value; // Number
	}

	return JSON.stringify(value);
}

/**
 * Generates YAML frontmatter from data using property mappings.
 * 
 * @param data - Object containing field values
 * @param propertyNames - Maps field IDs to property names
 * @param propertyValues - Maps field IDs to property value templates
 * @returns YAML frontmatter string with --- delimiters, or empty string if no properties
 * 
 * @example
 * ```ts
 * const propertyNames = new Map([['title', 'title'], ['date', 'created']]);
 * const propertyValues = new Map([['title', '{{title}}'], ['date', '{{date}}']]);
 * const data = { title: 'My Note', date: '2025-10-01' };
 * 
 * const frontmatter = generateFrontmatter(data, propertyNames, propertyValues, convertToYAML);
 * // Returns:
 * // ---
 * // title: My Note
 * // created: 2025-10-01
 * // ---
 * ```
 */
export function generateFrontmatter(
	data: Record<string, string>,
	propertyNames: Map<string, string>,
	propertyValues: Map<string, string>,
): string {
	if (propertyNames.size === 0) return '';

	const lines = ['---'];

	for (const [fieldId, propertyName] of propertyNames) {
		if (!propertyName) continue; // Skip if property name is empty

		const valueTemplate = propertyValues.get(fieldId) || '';
		if (!valueTemplate) continue; // Skip if property value is empty

		// Apply the template to get the actual value
		const value = applyTemplate(valueTemplate, data);
		const yamlValue = convertToYAML(value);

		lines.push(`${propertyName}: ${yamlValue}`);
	}

	lines.push('---');
	return lines.join('\n');
}

