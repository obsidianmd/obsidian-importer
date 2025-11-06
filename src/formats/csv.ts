import { BasesConfigFile, Notice, Setting, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import {
	TemplateConfigurator,
	TemplateConfig,
	TemplateField,
	applyTemplate,
	generateFrontmatter
} from '../template';
import { createBaseFile } from '../base';

interface CSVRow {
	[key: string]: string;
}

export class CSVImporter extends FormatImporter {
	private csvHeaders: string[] = [];
	private csvRows: CSVRow[] = [];
	private config: TemplateConfig | null = null;
	private hasHeaderRow: boolean;

	init() {
		this.addFileChooserSetting('CSV', ['csv']);
		this.addOutputLocationSetting('CSV import');

		this.hasHeaderRow = true;
		new Setting(this.modal.contentEl)
			.setName('CSV has header row')
			.setDesc('If enabled, the first row of the CSV file will be treated as column headers.')
			.addToggle(toggle => {
				toggle.setValue(this.hasHeaderRow);
				toggle.onChange(async (value) => {
					this.hasHeaderRow = value;
				});
			});
	}

	async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement): Promise<boolean> {
		const { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one CSV file to import.');
			return false;
		}

		if (files.length > 1) {
			// NOTE: This shouldn't be possible due to the file chooser settings.
			new Notice('CSV files must be imported one at a time.');
			return false;
		}

		// Parse CSV files to extract headers
		const file = files[0];
		if (ctx.isCancelled()) return false;

		ctx.status('Parsing ' + file.name);
		const csvContent = await file.readText();
		const parsedData = this.parseCSV(csvContent);

		// Store all rows for later processing
		if (this.csvHeaders.length === 0 && parsedData.rows.length > 0) {
			this.csvHeaders = parsedData.headers;
		}
		this.csvRows.push(...parsedData.rows);

		if (this.csvHeaders.length === 0 || this.csvRows.length === 0) {
			new Notice('No data found in CSV file(s).');
			return false;
		}

		// Prepare template fields
		const fields: TemplateField[] = this.csvHeaders.map(header => ({
			id: header,
			label: header,
			exampleValue: this.findExampleValue(header),
		}));

		// Set up defaults
		const propertyNames = new Map<string, string>();
		const propertyValues = new Map<string, string>();
		this.csvHeaders.forEach(header => {
			propertyNames.set(header, this.sanitizeYAMLKey(header));
			propertyValues.set(header, `{{${header}}}`);
		});

		const titleTemplate = this.csvHeaders.length > 0 ? `{{${this.csvHeaders[0]}}}` : '';

		// Create and show configurator
		const configurator = new TemplateConfigurator({
			fields,
			defaults: {
				titleTemplate,
				locationTemplate: '',
				bodyTemplate: '',
				propertyNames,
				propertyValues,
			},
			placeholderSyntax: '{{column_name}}',
		});

		this.config = await configurator.show(container);

		// Return false if user cancelled
		return this.config !== null;
	}

	async import(ctx: ImportContext): Promise<void> {
		// Config was already set by showTemplateConfiguration.
		if (!this.config) {
			new Notice('Configuration is missing.');
			return;
		}

		// Process all rows
		await this.processRows(ctx);
	}

	/**
	 * Look for a non-empty example value for the given header.
	 */
	private findExampleValue(header: string): string {
		for (const row of this.csvRows) {
			const value = row[header];
			if (value && value.trim().length > 0) {
				return value;
			}
		}
		return '';
	}

	private parseCSV(content: string): { headers: string[], rows: CSVRow[] } {
		const lines = this.splitCSVLines(content);
		if (lines.length === 0) {
			return { headers: [], rows: [] };
		}

		let headers: string[];
		let startIndex: number;

		if (this.hasHeaderRow) {
			// First row contains headers
			headers = this.parseCSVLine(lines[0]);
			startIndex = 1;
		}
		else {
			// No header row - generate column names
			const firstRowValues = this.parseCSVLine(lines[0]);
			headers = firstRowValues.map((_, index) => `Column ${index + 1}`);
			startIndex = 0;
		}

		const rows: CSVRow[] = [];

		for (let i = startIndex; i < lines.length; i++) {
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


	private sanitizeYAMLKey(key: string): string {
		// Remove special characters that aren't valid in YAML keys
		return key.replace(/[^\w\s-]/g, '');
	}

	private async processRows(ctx: ImportContext): Promise<void> {
		if (!this.config) {
			new Notice('Configuration is missing.');
			return;
		}

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
				const title = applyTemplate(this.config.titleTemplate, row);
				if (!title.trim()) {
					ctx.reportSkipped(`Row ${i + 1}`, 'Empty title');
					continue;
				}

				ctx.status(`Creating note: ${title}`);

				// Generate location
				const locationPath = applyTemplate(this.config.locationTemplate, row);
				const targetFolder = await this.getTargetFolder(folder, locationPath);

				// Generate content
				let content = '';

				// Add frontmatter
				const frontmatter = generateFrontmatter(
					row,
					this.config.propertyNames,
					this.config.propertyValues,
				);
				if (frontmatter) {
					content += frontmatter + '\n\n';
				}

				// Add body
				const body = applyTemplate(this.config.bodyTemplate, row);
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

		// Create Base file after all rows are processed (only if importing to a subfolder)
		if (!ctx.isCancelled() && folder.path !== '') {
			await this.createBase(folder);
		}
	}

	private async createBase(folder: TFolder): Promise<void> {
		try {
			// Collect property names that are defined
			const propertyNames: string[] = Array.from(this.config!.propertyNames.values())
				.filter(name => name && name.trim());

			// Add file.name as the first column
			const orderedColumns = ['file.name', ...propertyNames];

			// Use the folder name for the base file name
			const folderName = folder.name;

			// Create the base file in the parent folder
			const parentFolder = folder.parent || folder;

			const baseContents: BasesConfigFile = {
				filters: `file.folder == "${folder.path}"`,
				views: [{
					type: 'table',
					name: 'Table',
					order: orderedColumns,
				}]
			};

			await createBaseFile(
				parentFolder,
				folderName,
				baseContents,
				this.app.vault
			);
		}
		catch (e) {
			console.error('Failed to create Base file:', e);
			// Don't fail the entire import if base file creation fails
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

