import { Notice, Setting, TFolder, setIcon } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

interface CSVRow {
	[key: string]: string;
}

interface CSVConfig {
	propertyNames: Map<string, string>; // Maps original column name to custom property name
	propertyValues: Map<string, string>; // Maps original column name to property value template
	titleTemplate: string;
	bodyTemplate: string;
	locationTemplate: string;
}

export class CSVImporter extends FormatImporter {
	private csvHeaders: string[] = [];
	private csvRows: CSVRow[] = [];
	private config: CSVConfig = {
		propertyNames: new Map(),
		propertyValues: new Map(),
		titleTemplate: '',
		bodyTemplate: '',
		locationTemplate: '',
	};
	private configUI: HTMLElement | null = null;

	init() {
		this.addFileChooserSetting('CSV', ['csv']);
		this.addOutputLocationSetting('CSV import');
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one CSV file to import.');
			return;
		}

		// Parse CSV files
		for (const file of files) {
			if (ctx.isCancelled()) return;

			ctx.status('Parsing ' + file.name);
			const csvContent = await file.readText();
			const parsedData = this.parseCSV(csvContent);

			// If this is the first file, extract headers and show configuration UI
			if (this.csvHeaders.length === 0 && parsedData.rows.length > 0) {
				this.csvHeaders = parsedData.headers;
				this.csvRows = parsedData.rows;

				// Set default property names and values
				this.csvHeaders.forEach(header => {
					this.config.propertyNames.set(header, this.sanitizeYAMLKey(header));
					this.config.propertyValues.set(header, `{{${header}}}`);
				});

				// Pre-fill title template with first column if empty
				if (!this.config.titleTemplate && this.csvHeaders.length > 0) {
					this.config.titleTemplate = `{{${this.csvHeaders[0]}}}`;
				}

				// Show configuration UI and wait for user to configure
				await this.showConfigurationUI(ctx);
				
				// Check if user cancelled
				if (ctx.isCancelled()) return;
			}
			else {
				// Additional files use the same configuration
				this.csvRows.push(...parsedData.rows);
			}
		}

		// Now process all rows
		await this.processRows(ctx);
	}

	private parseCSV(content: string): { headers: string[], rows: CSVRow[] } {
		const lines = this.splitCSVLines(content);
		if (lines.length === 0) {
			return { headers: [], rows: [] };
		}

		const headers = this.parseCSVLine(lines[0]);
		const rows: CSVRow[] = [];

		for (let i = 1; i < lines.length; i++) {
			const values = this.parseCSVLine(lines[i]);
			if (values.length === 0) continue; // Skip empty lines

			const row: CSVRow = {};
			for (let j = 0; j < headers.length; j++) {
				row[headers[j]] = values[j] || '';
			}
			rows.push(row);
		}

		return { headers, rows };
	}

	private splitCSVLines(content: string): string[] {
		const lines: string[] = [];
		let currentLine = '';
		let inQuotes = false;

		for (let i = 0; i < content.length; i++) {
			const char = content[i];
			const nextChar = content[i + 1];

			if (char === '"') {
				currentLine += char; // Always add the quote to the line
				if (inQuotes && nextChar === '"') {
					// Escaped quote - add the second quote too
					currentLine += '"';
					i++; // Skip next quote
				}
				else {
					// Toggle quote state
					inQuotes = !inQuotes;
				}
			}
			else if (char === '\n' && !inQuotes) {
				// End of line
				if (currentLine.trim().length > 0) {
					lines.push(currentLine);
				}
				currentLine = '';
			}
			else if (char === '\r' && nextChar === '\n' && !inQuotes) {
				// Windows line ending
				if (currentLine.trim().length > 0) {
					lines.push(currentLine);
				}
				currentLine = '';
				i++; // Skip \n
			}
			else if (char === '\r' && !inQuotes) {
				// Mac line ending
				if (currentLine.trim().length > 0) {
					lines.push(currentLine);
				}
				currentLine = '';
			}
			else {
				currentLine += char;
			}
		}

		// Add last line if exists
		if (currentLine.trim().length > 0) {
			lines.push(currentLine);
		}

		return lines;
	}

	private parseCSVLine(line: string): string[] {
		const values: string[] = [];
		let currentValue = '';
		let inQuotes = false;
		let startOfField = true;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			const nextChar = line[i + 1];

			if (char === '"' && startOfField) {
				// Starting a quoted field
				inQuotes = true;
				startOfField = false;
			}
			else if (char === '"' && inQuotes) {
				if (nextChar === '"') {
					// Escaped quote - add one quote to the value
					currentValue += '"';
					i++; // Skip the next quote
				}
				else {
					// End of quoted field
					inQuotes = false;
				}
			}
			else if (char === ',' && !inQuotes) {
				// End of field
				values.push(currentValue);
				currentValue = '';
				startOfField = true;
			}
			else {
				// Regular character or comma inside quotes
				if (char !== ' ' || !startOfField || currentValue.length > 0) {
					currentValue += char;
					startOfField = false;
				}
			}
		}

		// Add last value
		values.push(currentValue);

		// Trim all values
		return values.map(v => v.trim());
	}

	private async showConfigurationUI(ctx: ImportContext): Promise<void> {
		return new Promise((resolve) => {
			// Clear modal content and show configuration
			const modalContent = this.modal.contentEl;
			modalContent.empty();

			modalContent.createEl('p', {
				text: 'Configure how your CSV data should be imported. Use {{column_name}} syntax to reference column values.',
			});

			// Note title template
			new Setting(modalContent)
				.setName('Note title')
				.setDesc('Template for the note title. Use {{column_name}} to insert values.')
				.addText(text => text
					.setPlaceholder('{{Title}}')
					.setValue(this.config.titleTemplate)
					.onChange(value => {
						this.config.titleTemplate = value;
					}));

			// Note location template
			new Setting(modalContent)
				.setName('Note location')
				.setDesc('Template for note location/path. Use {{column_name}} to organize notes.')
				.addText(text => text
					.setPlaceholder('{{Category}}/{{Subcategory}}')
					.setValue(this.config.locationTemplate)
					.onChange(value => {
						this.config.locationTemplate = value;
					}));

			// Column selection for frontmatter
			const headerContainer = modalContent.createDiv({ cls: 'csv-frontmatter-header' });
			headerContainer.createEl('h4', { text: 'Properties' });

			const columnContainer = modalContent.createDiv('csv-column-list');

			// Add header row
			const headerRow = columnContainer.createDiv('csv-column-header-row');
			headerRow.createDiv('csv-column-name-col').setText('Property name');
			headerRow.createDiv('csv-column-value-col').setText('Property value');
			headerRow.createDiv('csv-column-example-col').setText('Example');
			headerRow.createDiv('csv-column-delete-col'); // Empty space for delete button

			// Get first row for example values
			const firstRow = this.csvRows.length > 0 ? this.csvRows[0] : {};

			for (const header of this.csvHeaders) {
				const rowEl = columnContainer.createDiv('csv-column-row');
				
				// Property name input column
				const nameCol = rowEl.createDiv('csv-column-name-col');
				const nameInput = nameCol.createEl('input', {
					type: 'text',
					cls: 'csv-column-property',
					value: this.config.propertyNames.get(header) || ''
				});
				nameInput.addEventListener('input', () => {
					this.config.propertyNames.set(header, nameInput.value);
				});
				
				// Property value input column
				const valueCol = rowEl.createDiv('csv-column-value-col');
				const valueInput = valueCol.createEl('input', {
					type: 'text',
					cls: 'csv-column-property',
					value: this.config.propertyValues.get(header) || ''
				});
				valueInput.addEventListener('input', () => {
					this.config.propertyValues.set(header, valueInput.value);
				});
				
				// Example value column
				const exampleCol = rowEl.createDiv('csv-column-example-col');
				const exampleValue = firstRow[header] || '';
				const truncated = exampleValue.length > 50 
					? exampleValue.substring(0, 50) + '...' 
					: exampleValue;
				exampleCol.setText(truncated || '—');
				
				// Delete button column
				const deleteCol = rowEl.createDiv('csv-column-delete-col');
				const deleteButton = deleteCol.createEl('button', {
					cls: 'clickable-icon',
					attr: { 'aria-label': 'Delete property' }
				});
				setIcon(deleteButton, 'trash-2');
				deleteButton.addEventListener('click', () => {
					// Remove from configuration
					this.config.propertyNames.delete(header);
					this.config.propertyValues.delete(header);
					// Remove from UI
					rowEl.remove();
				});
			}

			// Note content template
			new Setting(modalContent)
				.setName('Note content')
				.setDesc('Template for the note content. Use {{column_name}} to insert values.')
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
			const buttonContainer = modalContent.createDiv('modal-button-container');
			buttonContainer.createEl('button', { cls: 'mod-cta', text: 'Continue' }, el => {
				el.addEventListener('click', () => {
					// Validate configuration
					if (!this.config.titleTemplate.trim()) {
						new Notice('Please provide a note title template.');
						return;
					}

					// Clear the configuration UI and restore the progress UI
					modalContent.empty();
					const progressEl = modalContent.createDiv();
					
					// Recreate the ImportContext UI in the new container
					ctx.el = progressEl;
					ctx.statusEl = progressEl.createDiv('importer-status');
					ctx.progressBarEl = progressEl.createDiv('importer-progress-bar', el => {
						ctx.progressBarInnerEl = el.createDiv('importer-progress-bar-inner');
					});
					progressEl.createDiv('importer-stats-container', el => {
						el.createDiv('importer-stat mod-imported', el => {
							ctx.importedCountEl = el.createDiv({ cls: 'importer-stat-count', text: ctx.notes.toString() });
							el.createDiv({ cls: 'importer-stat-name', text: 'imported' });
						});
						el.createDiv('importer-stat mod-attachments', el => {
							ctx.attachmentCountEl = el.createDiv({ cls: 'importer-stat-count', text: ctx.attachments.toString() });
							el.createDiv({ cls: 'importer-stat-name', text: 'attachments' });
						});
						el.createDiv('importer-stat mod-remaining', el => {
							ctx.remainingCountEl = el.createDiv({ cls: 'importer-stat-count', text: '0' });
							el.createDiv({ cls: 'importer-stat-name', text: 'remaining' });
						});
						el.createDiv('importer-stat mod-skipped', el => {
							ctx.skippedCountEl = el.createDiv({ cls: 'importer-stat-count', text: ctx.skipped.length.toString() });
							el.createDiv({ cls: 'importer-stat-name', text: 'skipped' });
						});
						el.createDiv('importer-stat mod-failed', el => {
							ctx.failedCountEl = el.createDiv({ cls: 'importer-stat-count', text: ctx.failed.length.toString() });
							el.createDiv({ cls: 'importer-stat-name', text: 'failed' });
						});
					});
					ctx.importLogEl = progressEl.createDiv('importer-log');
					ctx.importLogEl.hide();

					resolve();
				});
			});

			buttonContainer.createEl('button', { text: 'Cancel' }, el => {
				el.addEventListener('click', () => {
					this.modal.close();
				});
			});
		});
	}

	private applyTemplate(template: string, row: CSVRow): string {
		if (!template) return '';

		return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, columnName) => {
			const trimmedName = columnName.trim();
			return row[trimmedName] !== undefined ? row[trimmedName] : match;
		});
	}

	private generateFrontmatter(row: CSVRow): string {
		if (this.config.propertyNames.size === 0) return '';

		const lines = ['---'];

		for (const [column, propertyName] of this.config.propertyNames) {
			if (!propertyName) continue; // Skip if property name is empty

			const valueTemplate = this.config.propertyValues.get(column) || '';
			if (!valueTemplate) continue; // Skip if property value is empty
			
			// Apply the template to get the actual value
			const value = this.applyTemplate(valueTemplate, row);
			const yamlValue = this.convertToYAML(value);
			lines.push(`${propertyName}: ${yamlValue}`);
		}

		lines.push('---');
		return lines.join('\n');
	}

	private sanitizeYAMLKey(key: string): string {
		// Remove special characters that aren't valid in YAML keys
		return key.replace(/[^\w\s-]/g, '');
	}

	private convertToYAML(value: string): string {
		if (!value || value.trim() === '') {
			return '""';
		}

		const trimmed = value.trim();

		// Check for boolean
		if (trimmed.toLowerCase() === 'true') return 'true';
		if (trimmed.toLowerCase() === 'false') return 'false';

		// Check for number
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			return trimmed;
		}

		// Check for date (basic ISO format)
		if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(trimmed)) {
			return trimmed;
		}

		// Check if value needs quoting
		const needsQuotes = /[:#\[\]{}|>*&!%@`"]/.test(trimmed) || 
			trimmed !== trimmed.trim() ||
			trimmed.startsWith('-') ||
			trimmed.startsWith('?');

		if (needsQuotes || trimmed.includes('\n')) {
			// Escape quotes and wrap in quotes
			return '"' + trimmed.replace(/"/g, '\\"') + '"';
		}

		return trimmed;
	}

	private async processRows(ctx: ImportContext): Promise<void> {
		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.reportProgress(0, this.csvRows.length);

		for (let i = 0; i < this.csvRows.length; i++) {
			if (ctx.isCancelled()) return;

			const row = this.csvRows[i];

			try {
				// Generate title
				const title = this.applyTemplate(this.config.titleTemplate, row);
				if (!title.trim()) {
					ctx.reportSkipped(`Row ${i + 1}`, 'Empty title');
					continue;
				}

				ctx.status(`Creating note: ${title}`);

				// Generate location
				const locationPath = this.applyTemplate(this.config.locationTemplate, row);
				const targetFolder = await this.getTargetFolder(folder, locationPath);

				// Generate content
				let content = '';

				// Add frontmatter
				const frontmatter = this.generateFrontmatter(row);
				if (frontmatter) {
					content += frontmatter + '\n\n';
				}

				// Add body
				const body = this.applyTemplate(this.config.bodyTemplate, row);
				if (body) {
					content += body;
				}

				// Save file
				await this.saveAsMarkdownFile(targetFolder, title, content);
				ctx.reportNoteSuccess(title);
			}
			catch (e) {
				ctx.reportFailed(`Row ${i + 1}`, e);
			}

			ctx.reportProgress(i + 1, this.csvRows.length);
		}
	}

	private async getTargetFolder(baseFolder: TFolder, locationPath: string): Promise<TFolder> {
		if (!locationPath || !locationPath.trim()) {
			return baseFolder;
		}

		// Sanitize the path
		const sanitizedPath = this.sanitizeFilePath(locationPath);
		const fullPath = baseFolder.path + '/' + sanitizedPath;

		return await this.createFolders(fullPath);
	}
}

