import { Notice, Setting, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

interface CSVRow {
	[key: string]: string;
}

interface CSVConfig {
	enabledColumns: Set<string>;
	titleTemplate: string;
	bodyTemplate: string;
	locationTemplate: string;
}

export class CSVImporter extends FormatImporter {
	private csvHeaders: string[] = [];
	private csvRows: CSVRow[] = [];
	private config: CSVConfig = {
		enabledColumns: new Set(),
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

				// Enable all columns by default
				this.csvHeaders.forEach(header => this.config.enabledColumns.add(header));

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
				if (inQuotes && nextChar === '"') {
					// Escaped quote
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

		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			const nextChar = line[i + 1];

			if (char === '"') {
				if (inQuotes && nextChar === '"') {
					// Escaped quote
					currentValue += '"';
					i++; // Skip next quote
				}
				else {
					// Toggle quote state
					inQuotes = !inQuotes;
				}
			}
			else if (char === ',' && !inQuotes) {
				// End of value
				values.push(currentValue.trim());
				currentValue = '';
			}
			else {
				currentValue += char;
			}
		}

		// Add last value
		values.push(currentValue.trim());

		return values;
	}

	private async showConfigurationUI(ctx: ImportContext): Promise<void> {
		return new Promise((resolve) => {
			// Clear modal content and show configuration
			const modalContent = this.modal.contentEl;
			modalContent.empty();

			const configContainer = modalContent.createDiv('csv-config-container');

			configContainer.createEl('h3', { text: 'Configure CSV Import' });
			configContainer.createEl('p', {
				text: 'Configure how your CSV data should be imported. Use {{column_name}} syntax to reference column values.',
			});

			// Preview section placeholder (we'll fill it later)
			let previewEl: HTMLElement;

			const updatePreview = () => {
				if (previewEl) {
					this.updatePreview(previewEl);
				}
			};

			// Note title template
			new Setting(configContainer)
				.setName('Note title')
				.setDesc('Template for the note title. Use {{column_name}} to insert values.')
				.addText(text => text
					.setPlaceholder('{{Title}}')
					.setValue(this.config.titleTemplate)
					.onChange(value => {
						this.config.titleTemplate = value;
						updatePreview();
					}));

			// Note location template
			new Setting(configContainer)
				.setName('Note location')
				.setDesc('Template for note location/path. Use {{column_name}} to organize notes.')
				.addText(text => text
					.setPlaceholder('{{Category}}/{{Subcategory}}')
					.setValue(this.config.locationTemplate)
					.onChange(value => {
						this.config.locationTemplate = value;
						updatePreview();
					}));

			// Note body template
			new Setting(configContainer)
				.setName('Note body')
				.setDesc('Template for the note content. Use {{column_name}} to insert values.')
				.addTextArea(text => {
					text
						.setPlaceholder('{{Content}}')
						.setValue(this.config.bodyTemplate)
						.onChange(value => {
							this.config.bodyTemplate = value;
							updatePreview();
						});
					text.inputEl.rows = 6;
				});

			// Column selection for frontmatter
			const headerContainer = configContainer.createDiv({ cls: 'csv-frontmatter-header' });
			headerContainer.createEl('h4', { text: 'Frontmatter Properties' });
			
			// Add Select/Deselect All button
			new Setting(headerContainer)
				.setClass('csv-select-all-setting')
				.setDesc('Select which columns to include as frontmatter properties:')
				.addButton(button => {
					const allSelected = this.csvHeaders.every(h => this.config.enabledColumns.has(h));
					button
						.setButtonText(allSelected ? 'Deselect All' : 'Select All')
						.onClick(() => {
							const allSelected = this.csvHeaders.every(h => this.config.enabledColumns.has(h));
							if (allSelected) {
								// Deselect all
								this.config.enabledColumns.clear();
								button.setButtonText('Select All');
							}
							else {
								// Select all
								this.csvHeaders.forEach(h => this.config.enabledColumns.add(h));
								button.setButtonText('Deselect All');
							}
							// Update all toggles
							columnToggles.forEach((toggle, header) => {
								toggle.setValue(this.config.enabledColumns.has(header));
							});
							updatePreview();
						});
				});

			const columnContainer = configContainer.createDiv('csv-column-list');
			const columnToggles = new Map();

			for (const header of this.csvHeaders) {
				new Setting(columnContainer)
					.setName(header)
					.addToggle(toggle => {
						toggle
							.setValue(this.config.enabledColumns.has(header))
							.onChange(value => {
								if (value) {
									this.config.enabledColumns.add(header);
								}
								else {
									this.config.enabledColumns.delete(header);
								}
								updatePreview();
							});
						columnToggles.set(header, toggle);
					});
			}

			// Preview section
			configContainer.createEl('h4', { text: 'Preview' });
			previewEl = configContainer.createDiv('csv-preview');
			this.updatePreview(previewEl);

			// Buttons
			const buttonContainer = configContainer.createDiv('modal-button-container');
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

	private updatePreview(previewEl: HTMLElement) {
		previewEl.empty();

		if (this.csvRows.length === 0) {
			previewEl.createEl('p', { text: 'No data to preview.' });
			return;
		}

		const sampleRow = this.csvRows[0];

		previewEl.createEl('p', { text: 'Preview of first note:', cls: 'setting-item-description' });

		const previewContent = previewEl.createDiv('csv-preview-content');

		// Preview title
		const title = this.applyTemplate(this.config.titleTemplate, sampleRow);
		previewContent.createEl('div', { cls: 'csv-preview-title' }, el => {
			el.createEl('strong', { text: 'Title: ' });
			el.createSpan({ text: title || '(empty)' });
		});

		// Preview location
		const location = this.applyTemplate(this.config.locationTemplate, sampleRow);
		previewContent.createEl('div', { cls: 'csv-preview-location' }, el => {
			el.createEl('strong', { text: 'Location: ' });
			el.createSpan({ text: location || '(root)' });
		});

		// Preview frontmatter
		if (this.config.enabledColumns.size > 0) {
			previewContent.createEl('div', { cls: 'csv-preview-frontmatter' }, el => {
				el.createEl('strong', { text: 'Frontmatter:' });
				const fmCode = el.createEl('pre');
				fmCode.createEl('code', { text: this.generateFrontmatter(sampleRow) });
			});
		}

		// Preview body
		const body = this.applyTemplate(this.config.bodyTemplate, sampleRow);
		if (body) {
			previewContent.createEl('div', { cls: 'csv-preview-body' }, el => {
				el.createEl('strong', { text: 'Body preview:' });
				const bodyCode = el.createEl('pre');
				bodyCode.createEl('code', { text: body.substring(0, 200) + (body.length > 200 ? '...' : '') });
			});
		}
	}

	private applyTemplate(template: string, row: CSVRow): string {
		if (!template) return '';

		return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, columnName) => {
			const trimmedName = columnName.trim();
			return row[trimmedName] !== undefined ? row[trimmedName] : match;
		});
	}

	private generateFrontmatter(row: CSVRow): string {
		if (this.config.enabledColumns.size === 0) return '';

		const lines = ['---'];

		for (const column of this.config.enabledColumns) {
			if (row[column] !== undefined) {
				const value = row[column];
				const yamlValue = this.convertToYAML(value);
				lines.push(`${this.sanitizeYAMLKey(column)}: ${yamlValue}`);
			}
		}

		lines.push('---');
		return lines.join('\n');
	}

	private sanitizeYAMLKey(key: string): string {
		// Replace spaces and special characters with valid YAML key format
		return key.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').toLowerCase();
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

