import { normalizePath, Notice, Setting, DataWriteOptions, TFile } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { NotionApiClient } from './notion-api/notion-client';
import { NotionToMarkdownConverter } from './notion-api/notion-to-md';
import { BaseGenerator } from './notion-api/base-generator';

export class NotionApiImporter extends FormatImporter {
	notionToken: string = '';
	selectedDatabases: string[] = [];
	attachmentFolder: string = '';

	init() {
		this.addOutputLocationSetting('Notion API');
		
		// Notion Integration Token setting
		new Setting(this.modal.contentEl)
			.setName('Notion Integration Token')
			.setDesc('Your Notion integration token. Create one at https://www.notion.so/my-integrations')
			.addText((text) => text
				.setPlaceholder('secret_...')
				.setValue(this.notionToken)
				.onChange((value) => this.notionToken = value));

		// Database selection (will be populated after token is entered)
		const databaseSetting = new Setting(this.modal.contentEl)
			.setName('Select Databases')
			.setDesc('Choose which databases to import')
			.addButton((button) => button
				.setButtonText('Load Databases')
				.setCta()
				.onClick(async () => {
					if (!this.notionToken) {
						new Notice('Please enter your Notion integration token first');
						return;
					}
					await this.loadDatabases();
				}));

		// Attachment folder setting
		new Setting(this.modal.contentEl)
			.setName('Attachment folder')
			.setDesc('Folder to save downloaded attachments')
			.addText((text) => text
				.setPlaceholder('attachments')
				.setValue(this.attachmentFolder || 'attachments')
				.onChange((value) => this.attachmentFolder = value));
	}

	async loadDatabases() {
		try {
			const client = new NotionApiClient(this.notionToken);
			const databases = await client.getDatabases();
			
			// Clear existing database settings
			const existingSettings = this.modal.contentEl.querySelectorAll('.notion-database-setting');
			existingSettings.forEach(el => el.remove());

		// Add database selection checkboxes
		databases.forEach(db => {
			const setting = new Setting(this.modal.contentEl);
			setting.setName(db.title);
			setting.setDesc(`Database ID: ${db.id}`);
			setting.addToggle((toggle: any) => toggle
				.setValue(this.selectedDatabases.includes(db.id))
				.onChange((value: any) => {
					if (value) {
						this.selectedDatabases.push(db.id);
					} else {
						this.selectedDatabases = this.selectedDatabases.filter(id => id !== db.id);
					}
				}));
		});

			new Notice(`Found ${databases.length} databases`);
		} catch (error) {
			new Notice(`Failed to load databases: ${error.message}`);
		}
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.notionToken) {
			new Notice('Please enter your Notion integration token');
			return;
		}

		if (this.selectedDatabases.length === 0) {
			new Notice('Please select at least one database to import');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to');
			return;
		}

		const client = new NotionApiClient(this.notionToken);
		const converter = new NotionToMarkdownConverter(client, this.attachmentFolder);
		const baseGenerator = new BaseGenerator();

		ctx.status('Starting import from Notion API');

		for (const databaseId of this.selectedDatabases) {
			if (ctx.isCancelled()) return;

			try {
				ctx.status(`Importing database ${databaseId}`);
				
				// Get database info and data sources
				const database = await client.getDatabase(databaseId);
				const dataSources = await client.getDataSources(databaseId);
				
				// Generate .base file
				const baseContent = await baseGenerator.generateBase(database, dataSources);
				const basePath = `${folder.path}/${database.title || 'Database'}.base`;
				await this.app.vault.create(basePath, baseContent);

				// Import pages from each data source
				for (const dataSource of dataSources) {
					if (ctx.isCancelled()) return;

					ctx.status(`Importing pages from data source ${dataSource.name}`);
					
					const pages = await client.getPagesFromDataSource(dataSource.id);
					
					for (const page of pages) {
						if (ctx.isCancelled()) return;

						try {
							ctx.status(`Converting page: ${page.title || 'Untitled'}`);
							
							// Convert page to markdown
							const markdown = await converter.convertPage(page.id);
							
							// Create the markdown file
							const fileName = this.sanitizeFileName(page.title || 'Untitled');
							const filePath = `${folder.path}/${fileName}.md`;
							
							await this.app.vault.create(filePath, markdown);
							ctx.reportNoteSuccess(filePath);
							
						} catch (error) {
							ctx.reportFailed(`Page ${page.id}`, error);
						}
					}
				}

			} catch (error) {
				ctx.reportFailed(`Database ${databaseId}`, error);
			}
		}

		ctx.status('Import completed');
	}

	private sanitizeFileName(name: string): string {
		return name
			.replace(/[<>:"/\\|?*]/g, '_')
			.replace(/\s+/g, '_')
			.substring(0, 100);
	}
}
