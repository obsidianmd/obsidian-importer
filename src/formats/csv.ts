import { BasesConfigFile, Notice, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { CSVRow, parseCSV } from './csv/parse';
import { convertRow, defaultTemplateConfig, sanitizeYAMLKey } from './csv/convert';
import {
	TemplateConfigurator,
	TemplateConfig,
	TemplateField,
} from '../template';
import { createBaseFile } from '../base';

export class CSVImporter extends FormatImporter {
	interruption = 'pause' as const;

	private csvHeaders: string[] = [];
	private csvRows: CSVRow[] = [];
	private config: TemplateConfig | null = null;
	private hasHeaderRow: boolean;

	init() {
		this.addFileChooserSetting(i18n.importer.csv.fileType(), ['csv']);
		this.defaultOutputFolder = 'CSV import';

		this.hasHeaderRow = true;
		this.addSetting()
			?.setName(i18n.importer.csv.nameHeaderRow())
			.setDesc(i18n.importer.csv.descHeaderRow())
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
			new Notice(i18n.importer.csv.msgPickFile());
			return false;
		}

		if (files.length > 1) {
			// NOTE: This shouldn't be possible due to the file chooser settings.
			new Notice(i18n.importer.csv.msgOneAtATime());
			return false;
		}

		// Parse CSV files to extract headers
		const file = files[0];
		if (await ctx.shouldStop()) return false;

		ctx.status(i18n.importer.csv.statusParsing({ name: file.name }));
		const csvContent = await file.readText();
		const parsedData = parseCSV(csvContent, this.hasHeaderRow);

		// Store all rows for later processing
		if (this.csvHeaders.length === 0 && parsedData.rows.length > 0) {
			this.csvHeaders = parsedData.headers;
		}
		this.csvRows.push(...parsedData.rows);

		if (this.csvHeaders.length === 0 || this.csvRows.length === 0) {
			new Notice(i18n.importer.csv.msgNoData({ name: file.name }));
			return false;
		}

		// Prepare template fields
		const fields: TemplateField[] = this.csvHeaders.map(header => ({
			id: header,
			label: header,
			exampleValue: this.findExampleValue(header),
		}));

		// Create and show configurator
		const configurator = new TemplateConfigurator({
			fields,
			defaults: defaultTemplateConfig(this.csvHeaders, sanitizeYAMLKey),
			placeholderSyntax: '{{column_name}}',
		});

		this.config = await configurator.show(container);

		// Return false if user cancelled
		return this.config !== null;
	}

	async import(ctx: ImportContext): Promise<void> {
		// Config was already set by showTemplateConfiguration.
		if (!this.config) {
			new Notice(i18n.importer.csv.msgNoConfiguration());
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

	private async processRows(ctx: ImportContext): Promise<void> {
		if (!this.config) {
			new Notice(i18n.importer.csv.msgNoConfiguration());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		ctx.reportProgress(0, this.csvRows.length);

		for (let i = 0; i < this.csvRows.length; i++) {
			if (await ctx.shouldStop()) return;

			const row = this.csvRows[i];

			try {
				const { title, location, content } = convertRow(row, this.config);
				if (!title.trim()) {
					ctx.reportSkipped(i18n.importer.csv.labelRow({ number: i + 1 }), i18n.importer.csv.reasonEmptyTitle());
					continue;
				}

				ctx.status(i18n.importer.csv.statusCreatingNote({ title }));

				const targetFolder = await this.getTargetFolder(folder, location);
				const { written } = await this.writeNote(ctx, targetFolder, title, content);
				if (written) ctx.reportNoteSuccess(title);
			}
			catch (e) {
				ctx.reportFailed(i18n.importer.csv.labelRow({ number: i + 1 }), e);
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

