import { Notice, Setting } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { NotionApiClient } from './notion-api/api-client';
import { isDatabaseObject, type NotionDatabaseWithProperties } from './notion-api/notion-types';
import { convertDatabaseToBase, writeBaseFile, createDatabaseTag } from './notion-api/base-converter';
import { BlockConverter } from './notion-api/block-converter';
import type { PageObjectResponse, RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints';

export class NotionApiImporter extends FormatImporter {
	integrationToken: string = '';
	databaseId: string = '';
	client: NotionApiClient | null = null;

	init() {
		this.addOutputLocationSetting('Notion');

		new Setting(this.modal.contentEl)
			.setName('Notion Integration Token')
			.setDesc('Enter your Notion integration token. You can create one at https://www.notion.so/my-integrations')
			.addText(text => text
				.setPlaceholder('secret_...')
				.setValue(this.integrationToken)
				.onChange(value => {
					this.integrationToken = value;
					if (value) {
						this.client = new NotionApiClient({ auth: value });
					}
				}));

		new Setting(this.modal.contentEl)
			.setName('Database ID (Optional)')
			.setDesc('Enter a specific database ID to import only that database. Leave empty to import all accessible databases.')
			.addText(text => text
				.setPlaceholder('a1b2c3d4e5f6...')
				.setValue(this.databaseId)
				.onChange(value => {
					this.databaseId = value.trim();
				}));
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.integrationToken) {
			new Notice('Please enter a Notion integration token.');
			return;
		}

		if (!this.client) {
			this.client = new NotionApiClient({ auth: this.integrationToken });
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select an output location.');
			return;
		}

		try {
			let databases: NotionDatabaseWithProperties[] = [];

			if (this.databaseId) {
				ctx.status(`Retrieving database ${this.databaseId}...`);

				const database = await this.client.getDatabase(this.databaseId);

				if (!isDatabaseObject(database)) {
					new Notice('The provided ID does not correspond to a database.');
					return;
				}

				databases.push(database);
			} else {
				ctx.status('Searching for databases in workspace...');

				const searchResults = await this.client.searchAll();

				for (const result of searchResults) {
					if (isDatabaseObject(result)) {
						databases.push(result);
					}
				}

				if (databases.length === 0) {
					new Notice('No databases found in workspace. Make sure your integration has access to the databases.');
					return;
				}
			}

			ctx.status(`Found ${databases.length} database${databases.length === 1 ? '' : 's'}. Starting conversion...`);

			for (let i = 0; i < databases.length; i++) {
				if (ctx.isCancelled()) return;

				const database = databases[i];
				ctx.reportProgress(i, databases.length);
				ctx.status(`Converting database ${i + 1}/${databases.length}`);

				try {
					await this.convertDatabase(ctx, database, folder.path);
				} catch (error) {
					ctx.reportFailed(database.id, error);
				}
			}

			ctx.status('Import complete!');
			new Notice(`Successfully imported ${databases.length} database${databases.length === 1 ? '' : 's'}.`);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Import failed: ${errorMessage}`);
			console.error('Notion API import error:', error);
		}
	}

	async convertDatabase(
		ctx: ImportContext,
		database: NotionDatabaseWithProperties,
		outputPath: string
	): Promise<void> {
		if (!this.client) {
			throw new Error('Client not initialized');
		}

		const buildResult = convertDatabaseToBase(database);

		if (buildResult.warnings.length > 0) {
			console.warn(`Warnings for database ${buildResult.databaseTitle}:`, buildResult.warnings);
		}

		const sanitizedTitle = this.sanitizeFilePath(buildResult.databaseTitle);
		await this.createFolders(outputPath);

		await writeBaseFile(this.vault, buildResult.schema, outputPath, sanitizedTitle, buildResult.databaseTitle);

		ctx.status(`Fetching pages from database: ${buildResult.databaseTitle}`);
		const pages = await this.client.getAllDatabasePages(database.id);

		for (const page of pages) {
			if (ctx.isCancelled()) return;

			try {
				await this.convertPage(ctx, page, database.id, outputPath);
			} catch (error) {
				ctx.reportFailed(page.id, error);
			}
		}

		ctx.reportNoteSuccess(`${buildResult.databaseTitle}.base`);
	}

	async convertPage(
		ctx: ImportContext,
		page: PageObjectResponse,
		databaseId: string,
		outputPath: string
	): Promise<void> {
		if (!this.client) {
			throw new Error('Client not initialized');
		}

		const pageTitle = this.extractPageTitle(page);
		const sanitizedTitle = this.sanitizeFilePath(pageTitle || 'Untitled');

		const frontmatter = createDatabaseTag(databaseId);

		const frontmatterLines = Object.entries(frontmatter)
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join('\n');

		const attachmentFolder = `${outputPath}/${sanitizedTitle}-attachments`;
		await this.createFolders(attachmentFolder);

		const blockConverter = new BlockConverter(this.client, this.vault, attachmentFolder);

		ctx.status(`Converting page: ${pageTitle}`);
		const pageContent = await blockConverter.convertBlocksToMarkdown(page.id);

		const content = `---\n${frontmatterLines}\n---\n\n# ${pageTitle}\n\n${pageContent}`;

		const filePath = `${outputPath}/${sanitizedTitle}.md`;

		try {
			await this.vault.create(filePath, content);
			ctx.reportNoteSuccess(page.id);
		} catch (error) {
			if (error instanceof Error && error.message.includes('already exists')) {
				const uniquePath = await this.getAvailablePathForAttachment(
					`${sanitizedTitle}.md`,
					[]
				);
				await this.vault.create(uniquePath, content);
				ctx.reportNoteSuccess(page.id);
			} else {
				throw error;
			}
		}
	}

	extractPageTitle(page: PageObjectResponse): string {
		const properties = page.properties;

		for (const prop of Object.values(properties)) {
			if (typeof prop === 'object' && prop !== null && 'type' in prop && prop.type === 'title') {
				if ('title' in prop) {
					const titleValue = prop.title;
					if (Array.isArray(titleValue)) {
						const titleParts = (titleValue as RichTextItemResponse[])
							.filter(part => part.type === 'text' && 'text' in part && part.text?.content)
							.map(part => {
								if (part.type === 'text' && 'text' in part) {
									return part.text.content;
								}
								return '';
							});

						const result = titleParts.join('');
						if (result) {
							return result;
						}
					}
				}
			}
		}

		return 'Untitled';
	}
}
