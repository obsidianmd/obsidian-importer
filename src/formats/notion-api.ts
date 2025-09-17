import { Notice, Setting, normalizePath, TFolder, TFile, requestUrl } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { sanitizeFileName } from '../util';

interface NotionPage {
	id: string;
	properties: any;
	created_time: string;
	last_edited_time: string;
	parent: any;
	url: string;
}

interface NotionDatabase {
	id: string;
	title: any[];
	properties: any;
	created_time: string;
	last_edited_time: string;
}

interface NotionBlock {
	id: string;
	type: string;
	has_children: boolean;
	created_time: string;
	last_edited_time: string;
	[key: string]: any; // For block-specific properties
}

interface RichText {
	type: string;
	text?: {
		content: string;
		link?: { url: string };
	};
	mention?: any;
	equation?: { expression: string };
	plain_text: string;
	href?: string;
	annotations: {
		bold: boolean;
		italic: boolean;
		strikethrough: boolean;
		underline: boolean;
		code: boolean;
		color: string;
	};
}

/**
 * Notion API Importer for Obsidian
 *
 * Imports pages and databases directly from Notion using the Notion API.
 * Requires a Notion integration token with access to the desired content.
 *
 * Features:
 * - Direct API access (no manual export needed)
 * - Preserves database structure with YAML frontmatter
 * - Generates .base files for Obsidian's database views
 * - Handles rich text formatting and block conversion
 * - Rate limiting to respect Notion API limits
 */
export class NotionAPIImporter extends FormatImporter {
	integrationToken: string = '';
	pageIdToFilename: Record<string, string> = {};
	userIdToName: Record<string, string> = {};

	// Rate limiting - Notion API allows ~3 requests per second
	private lastRequestTime: number = 0;
	private readonly REQUEST_INTERVAL = 334; // ~3 requests per second

	init(): void {
		this.addOutputLocationSetting('Notion (API) import');
		this.addTokenSetting();

		// Don't add file chooser since we're using API
		// Note: Import button will be handled by the main modal based on notAvailable
		this.notAvailable = !this.integrationToken;
	}

	private addTokenSetting(): void {
		new Setting(this.modal.contentEl)
			.setName('Notion Integration Token')
			.setDesc('Enter your internal integration token (starts with "secret_"). Make sure the token has access to the databases you want to import.')
			.addText(text => text
				.setPlaceholder('secret_...')
				.setValue(this.integrationToken)
				.onChange(val => {
					this.integrationToken = val.trim();

					// Re-check availability
					const wasNotAvailable = this.notAvailable;
					this.notAvailable = !this.integrationToken;

					// If we just became available, manually add the Import button
					if (wasNotAvailable && !this.notAvailable) {
						this.addImportButton();
					}
				}));
	}

	private addImportButton(): void {
		// Check if Import button already exists
		const existingButton = this.modal.contentEl.querySelector('.modal-button-container');
		if (existingButton) return;

		// Add the Import button manually
		this.modal.contentEl.createDiv('modal-button-container', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Import' }, button => {
				button.addEventListener('click', async () => {
					if ((this.modal as any).current) {
						(this.modal as any).current.cancel();
					}
					this.modal.contentEl.empty();
					let progressEl = this.modal.contentEl.createDiv();

					let ctx = (this.modal as any).current = new ImportContext(progressEl);

					let buttonsEl = this.modal.contentEl.createDiv('modal-button-container');
					let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: 'Stop' }, el => {
						el.addEventListener('click', () => {
							ctx.cancel();
							cancelButtonEl.detach();
						});
					});
					try {
						await this.import(ctx);
					}
					finally {
						if ((this.modal as any).current === ctx) {
							(this.modal as any).current = null;
						}
						buttonsEl.createEl('button', { text: 'Import more' }, el => {
							el.addEventListener('click', () => this.modal.updateContent());
						});
						cancelButtonEl.detach();
						buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
							el.addEventListener('click', () => this.modal.close());
						});
						ctx.hideStatus();
					}
				});
			});
		});
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.integrationToken) {
			new Notice('Please enter a Notion integration token.');
			return;
		}

		try {
			ctx.status('Connecting to Notion API...');

			// Test the connection
			await this.testConnection();

			// Get output folder
			const outputFolder = await this.getOutputFolder();
			if (!outputFolder) {
				new Notice('Please select a location to export to.');
				return;
			}

			// Discover and import content
			await this.discoverAndImportContent(ctx, outputFolder);

		}
		catch (error: any) {
			console.error('Notion API import failed:', error);

			let errorMessage = 'Unknown error';
			if (error.message) {
				errorMessage = error.message;
			}
			else if (typeof error === 'string') {
				errorMessage = error;
			}

			// Add more context for common errors
			if (errorMessage.includes('Failed to fetch') || errorMessage.includes('fetch')) {
				errorMessage = 'Network connection failed. Check your internet connection and try again.';
			}
			else if (errorMessage.includes('unauthorized')) {
				errorMessage = 'Invalid integration token. Please check your token and ensure it has the necessary permissions.';
			}

			ctx.reportFailed('Import', errorMessage);
			new Notice(`Notion import failed: ${errorMessage}`);
		}
	}

	private async testConnection(): Promise<void> {
		try {
			console.log('Testing Notion API connection...');
			const result = await this.makeNotionRequest('GET', '/v1/users/me');
			console.log('Notion API connection successful:', result);
		}
		catch (error: any) {
			console.error('Notion API connection failed:', error);

			if (error.status === 401 || error.message?.includes('unauthorized')) {
				throw new Error('Invalid integration token. Please check your token and ensure it has the necessary permissions.');
			}
			throw error;
		}
	}

	/**
	 * Custom HTTP client using Obsidian's requestUrl API
	 */
	private async makeNotionRequest(method: string, endpoint: string, body?: any): Promise<any> {
		const url = `https://api.notion.com${endpoint}`;

		const headers: Record<string, string> = {
			'Authorization': `Bearer ${this.integrationToken}`,
			'Notion-Version': '2022-06-28',
			'Content-Type': 'application/json'
		};

		try {
			const response = await requestUrl({
				url,
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined
			});

			return response.json;
		}
		catch (error: any) {
			console.error(`Notion API request failed for ${method} ${endpoint}:`, error);
			throw new Error(`API request failed: ${error.message || 'Unknown error'}`);
		}
	}

	private async rateLimitedRequest<T>(request: () => Promise<T>): Promise<T> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;

		if (timeSinceLastRequest < this.REQUEST_INTERVAL) {
			const delay = this.REQUEST_INTERVAL - timeSinceLastRequest;
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		this.lastRequestTime = Date.now();

		try {
			return await request();
		}
		catch (error: any) {
			if (error.code === 'rate_limited') {
				console.warn('Hit Notion API rate limit, pausing...');
				await new Promise(resolve => setTimeout(resolve, 1000));
				return await request(); // Retry once
			}
			throw error;
		}
	}

	private async discoverAndImportContent(ctx: ImportContext, outputFolder: TFolder): Promise<void> {
		ctx.status('Discovering Notion databases and pages...');

		// Search for all databases
		const databases = await this.getAllDatabases();

		// Search for standalone pages (not in databases)
		const standalonePages = await this.getStandalonePages();

		const totalItems = databases.length + standalonePages.length;
		ctx.reportProgress(0, totalItems);

		let processedItems = 0;

		// Process each database
		for (const database of databases) {
			if (ctx.isCancelled()) return;

			ctx.status(`Importing database: ${this.getDatabaseName(database)}`);
			await this.importDatabase(database, outputFolder, ctx);

			processedItems++;
			ctx.reportProgress(processedItems, totalItems);
		}

		// Process standalone pages
		for (const page of standalonePages) {
			if (ctx.isCancelled()) return;

			ctx.status(`Importing page: ${this.getPageTitle(page)}`);
			await this.importStandalonePage(page, outputFolder, ctx);

			processedItems++;
			ctx.reportProgress(processedItems, totalItems);
		}

		ctx.status('Import completed successfully');
	}

	private async getAllDatabases(): Promise<NotionDatabase[]> {
		const databases: NotionDatabase[] = [];
		let hasMore = true;
		let startCursor: string | undefined;

		while (hasMore) {
			const body: any = {
				filter: { property: 'object', value: 'database' },
				page_size: 100
			};
			if (startCursor) {
				body.start_cursor = startCursor;
			}

			const response = await this.rateLimitedRequest(() =>
				this.makeNotionRequest('POST', '/v1/search', body)
			);

			databases.push(...response.results as NotionDatabase[]);
			hasMore = response.has_more;
			startCursor = response.next_cursor || undefined;
		}

		return databases;
	}

	private async getStandalonePages(): Promise<NotionPage[]> {
		const allPages: NotionPage[] = [];
		let hasMore = true;
		let startCursor: string | undefined;

		while (hasMore) {
			const body: any = {
				filter: { property: 'object', value: 'page' },
				page_size: 100
			};
			if (startCursor) {
				body.start_cursor = startCursor;
			}

			const response = await this.rateLimitedRequest(() =>
				this.makeNotionRequest('POST', '/v1/search', body)
			);

			allPages.push(...response.results as NotionPage[]);
			hasMore = response.has_more;
			startCursor = response.next_cursor || undefined;
		}

		// Filter out pages that are part of databases
		const standalonePages = allPages.filter(page =>
			page.parent?.type !== 'database_id'
		);

		return standalonePages;
	}

	private async importDatabase(database: NotionDatabase, outputFolder: TFolder, ctx: ImportContext): Promise<void> {
		const dbName = this.getDatabaseName(database);
		const sanitizedDbName = sanitizeFileName(dbName);

		// Create folder for database
		const dbFolderPath = normalizePath(`${outputFolder.path}/${sanitizedDbName}`);
		const dbFolder = await this.createFolders(dbFolderPath);

		// Get all pages in the database
		const pages = await this.getDatabasePages(database.id);

		// Import each page
		for (const page of pages) {
			if (ctx.isCancelled()) return;

			const fileName = this.getPageTitle(page);
			ctx.status(`Importing database page: ${fileName}`);

			await this.importPage(page, dbFolder, ctx, database);
		}

		// Generate Base file for the database
		await this.generateBaseFile(database, dbFolder, pages);
	}

	private async getDatabasePages(databaseId: string): Promise<NotionPage[]> {
		const pages: NotionPage[] = [];
		let hasMore = true;
		let startCursor: string | undefined;

		while (hasMore) {
			const body: any = {
				page_size: 100
			};
			if (startCursor) {
				body.start_cursor = startCursor;
			}

			const response = await this.rateLimitedRequest(() =>
				this.makeNotionRequest('POST', `/v1/databases/${databaseId}/query`, body)
			);

			pages.push(...response.results as NotionPage[]);
			hasMore = response.has_more;
			startCursor = response.next_cursor || undefined;
		}

		return pages;
	}

	private async importStandalonePage(page: NotionPage, outputFolder: TFolder, ctx: ImportContext): Promise<void> {
		await this.importPage(page, outputFolder, ctx);
	}

	private async importPage(page: NotionPage, folder: TFolder, ctx: ImportContext, database?: NotionDatabase): Promise<void> {
		const title = this.getPageTitle(page);
		const fileName = sanitizeFileName(title) + '.md';

		// Get page content
		const markdownContent = await this.convertPageToMarkdown(page, ctx);

		// Build frontmatter
		const frontmatter = this.buildFrontmatter(page, database);

		// Combine frontmatter and content
		let fileContent = '';
		if (frontmatter) {
			fileContent += frontmatter + '\n\n';
		}
		fileContent += markdownContent;

		// Save file
		const file = await this.saveAsMarkdownFile(folder, fileName, fileContent);

		// Set file timestamps
		const ctime = new Date(page.created_time).getTime();
		const mtime = new Date(page.last_edited_time).getTime();
		if (ctime && mtime) {
			await this.vault.process(file, (data) => data, { ctime, mtime });
		}

		// Store mapping for links
		this.pageIdToFilename[page.id] = file.path;

		ctx.reportNoteSuccess(title);
	}

	private getDatabaseName(database: NotionDatabase): string {
		if (!database.title || database.title.length === 0) {
			return 'Untitled Database';
		}
		return database.title.map((t: any) => t.plain_text || '').join('') || 'Untitled Database';
	}

	private getPageTitle(page: NotionPage): string {
		// Find the title property
		const titleProp = Object.values(page.properties || {}).find((prop: any) =>
			prop.type === 'title'
		) as any;

		if (titleProp?.title?.length > 0) {
			return this.extractPlainText(titleProp.title);
		}

		return 'Untitled';
	}

	private extractPlainText(richTextArray: RichText[]): string {
		if (!Array.isArray(richTextArray)) return '';
		return richTextArray.map(rt => rt.plain_text || '').join('');
	}

	private buildFrontmatter(page: NotionPage, database?: NotionDatabase): string {
		const frontmatter: Record<string, any> = {};

		// Add categories using Kepano's pattern - database name as a linked category
		if (database) {
			const dbName = this.getDatabaseName(database);
			frontmatter.categories = [[dbName]];
			// Keep notion_database for compatibility
			frontmatter.notion_database = dbName;
			frontmatter.notion_database_id = database.id;
		}

		// Add page properties with note. prefix following Kepano's pattern
		if (page.properties) {
			for (const [propName, prop] of Object.entries(page.properties)) {
				const value = this.convertPropertyValue(prop as any, propName);
				if (value !== null && value !== undefined) {
					if (propName === 'Tags') {
						frontmatter.tags = value;
					}
					else if (propName !== 'Name' && propName !== 'Title') {
						// Use note. prefix for custom properties, following Kepano's pattern
						const noteProperty = propName.toLowerCase().replace(/\s+/g, '');
						frontmatter[`note.${noteProperty}`] = value;
					}
				}
			}
		}

		if (Object.keys(frontmatter).length === 0) {
			return '';
		}

		// Convert to YAML
		const yamlLines = ['---'];
		for (const [key, value] of Object.entries(frontmatter)) {
			if (Array.isArray(value)) {
				yamlLines.push(`${key}:`);
				for (const item of value) {
					yamlLines.push(`  - ${this.quoteIfNeeded(item)}`);
				}
			}
			else {
				yamlLines.push(`${key}: ${this.quoteIfNeeded(value)}`);
			}
		}
		yamlLines.push('---');

		return yamlLines.join('\n');
	}

	private convertPropertyValue(prop: any, propName: string): any {
		switch (prop.type) {
			case 'title':
			case 'rich_text':
				const text = this.extractPlainText(prop[prop.type] || []);
				return text || null;

			case 'number':
				return prop.number;

			case 'checkbox':
				return prop.checkbox;

			case 'select':
				return prop.select?.name || null;

			case 'multi_select':
				const options = prop.multi_select || [];
				let values = options.map((opt: any) => opt.name);
				// Replace spaces with hyphens for tags
				if (propName === 'Tags') {
					values = values.map((v: string) => v.replace(/\s+/g, '-'));
				}
				return values.length > 0 ? values : null;

			case 'date':
				if (!prop.date) return null;
				const start = prop.date.start;
				const end = prop.date.end;
				if (end) {
					return `${start} - ${end}`;
				}
				return start;

			case 'people':
				const people = prop.people || [];
				return people.length > 0 ? people.map((p: any) => p.name || 'Unknown User') : null;

			case 'relation':
				// For now, just store the IDs - we could resolve to names later
				const relations = prop.relation || [];
				return relations.length > 0 ? relations.map((r: any) => r.id) : null;

			case 'url':
			case 'email':
			case 'phone_number':
				return prop[prop.type] || null;

			case 'formula':
				if (!prop.formula) return null;
				return this.convertPropertyValue(prop.formula, 'formula_result');

			case 'rollup':
				// Simplified rollup handling
				if (prop.rollup?.type === 'array') {
					return prop.rollup.array?.map((item: any) =>
						this.convertPropertyValue(item, 'rollup_item')
					) || null;
				}
				return this.convertPropertyValue(prop.rollup || {}, 'rollup_result');

			default:
				return null;
		}
	}

	private quoteIfNeeded(value: any): string {
		if (typeof value === 'string') {
			// Quote if contains special characters or starts with special chars
			if (value.includes(':') || value.includes('#') || value.includes('[') ||
				value.includes(']') || value.includes('{') || value.includes('}') ||
				value.match(/^\s/) || value.match(/\s$/) || value.includes('\n')) {
				return `"${value.replace(/"/g, '\\"')}"`;
			}
			return value;
		}
		return String(value);
	}

	private async convertPageToMarkdown(page: NotionPage, ctx: ImportContext): Promise<string> {
		// Get all blocks for the page
		const blocks = await this.getAllBlocks(page.id);

		// Convert blocks to markdown
		return await this.convertBlocksToMarkdown(blocks, 0, ctx);
	}

	private async getAllBlocks(blockId: string): Promise<NotionBlock[]> {
		const blocks: NotionBlock[] = [];
		let hasMore = true;
		let startCursor: string | undefined;

		while (hasMore) {
			let endpoint = `/v1/blocks/${blockId}/children?page_size=100`;
			if (startCursor) {
				endpoint += `&start_cursor=${startCursor}`;
			}

			const response = await this.rateLimitedRequest(() =>
				this.makeNotionRequest('GET', endpoint)
			);

			const pageBlocks = response.results as NotionBlock[];

			// Recursively fetch children for blocks that have them
			for (const block of pageBlocks) {
				if (block.has_children) {
					const children = await this.getAllBlocks(block.id);
					(block as any).children = children;
				}
			}

			blocks.push(...pageBlocks);
			hasMore = response.has_more;
			startCursor = response.next_cursor || undefined;
		}

		return blocks;
	}

	private async convertBlocksToMarkdown(blocks: NotionBlock[], depth: number, ctx: ImportContext): Promise<string> {
		const markdown: string[] = [];

		for (const block of blocks) {
			if (ctx.isCancelled()) break;

			const blockMarkdown = await this.convertBlockToMarkdown(block, depth, ctx);
			if (blockMarkdown) {
				markdown.push(blockMarkdown);
			}
		}

		return markdown.join('\n\n');
	}

	private async convertBlockToMarkdown(block: NotionBlock, depth: number, ctx: ImportContext): Promise<string> {
		const indent = '    '.repeat(depth);

		switch (block.type) {
			case 'paragraph':
				return this.convertRichTextToMarkdown(block.paragraph?.rich_text || []);

			case 'heading_1':
				return '# ' + this.convertRichTextToMarkdown(block.heading_1?.rich_text || []);

			case 'heading_2':
				return '## ' + this.convertRichTextToMarkdown(block.heading_2?.rich_text || []);

			case 'heading_3':
				return '### ' + this.convertRichTextToMarkdown(block.heading_3?.rich_text || []);

			case 'bulleted_list_item':
				return await this.convertListItemToMarkdown(block, 'bulleted_list_item', indent, depth, ctx);

			case 'numbered_list_item':
				return await this.convertListItemToMarkdown(block, 'numbered_list_item', indent, depth, ctx);

			case 'to_do':
				return await this.convertListItemToMarkdown(block, 'to_do', indent, depth, ctx);

			case 'toggle':
				return await this.convertToggleToMarkdown(block, depth, ctx);

			case 'quote':
				const quoteText = this.convertRichTextToMarkdown(block.quote?.rich_text || []);
				return '> ' + quoteText.split('\n').join('\n> ');

			case 'code':
				const language = block.code?.language || '';
				const codeText = this.extractPlainText(block.code?.rich_text || []);
				return `\`\`\`${language}\n${codeText}\n\`\`\``;

			case 'equation':
				const equation = block.equation?.expression || '';
				return `$$\n${equation}\n$$`;

			case 'callout':
				return await this.convertCalloutToMarkdown(block, depth, ctx);

			case 'image':
			case 'file':
			case 'pdf':
			case 'video':
			case 'audio':
				return await this.handleAttachmentBlock(block, ctx);

			case 'bookmark':
				const url = block.bookmark?.url || '';
				const caption = this.convertRichTextToMarkdown(block.bookmark?.caption || []);
				return caption ? `[${caption}](${url})` : `<${url}>`;

			case 'divider':
				return '---';

			case 'table':
				return await this.convertTableToMarkdown(block, ctx);

			case 'column_list':
				return await this.convertColumnListToMarkdown(block, depth, ctx);

			default:
				// Unsupported block type
				ctx.reportSkipped(`Block type: ${block.type}`, 'Unsupported block type');
				return `<!-- Unsupported block type: ${block.type} -->`;
		}
	}

	private async convertListItemToMarkdown(block: NotionBlock, blockType: string, indent: string, depth: number, ctx: ImportContext): Promise<string> {
		let prefix = '';
		let text = '';

		if (blockType === 'bulleted_list_item') {
			prefix = `${indent}- `;
			text = this.convertRichTextToMarkdown(block.bulleted_list_item?.rich_text || []);
		}
		else if (blockType === 'numbered_list_item') {
			prefix = `${indent}1. `;
			text = this.convertRichTextToMarkdown(block.numbered_list_item?.rich_text || []);
		}
		else if (blockType === 'to_do') {
			const checked = block.to_do?.checked ? 'x' : ' ';
			prefix = `${indent}- [${checked}] `;
			text = this.convertRichTextToMarkdown(block.to_do?.rich_text || []);
		}

		let result = prefix + text;
		if ((block as any).children?.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown((block as any).children, depth + 1, ctx);
			if (childrenMarkdown) {
				result += '\n' + childrenMarkdown;
			}
		}
		return result;
	}

	private async convertToggleToMarkdown(block: NotionBlock, depth: number, ctx: ImportContext): Promise<string> {
		const toggleText = this.convertRichTextToMarkdown(block.toggle?.rich_text || []);
		let toggleContent = `<details>\n<summary>${toggleText}</summary>\n\n`;
		if ((block as any).children?.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown((block as any).children, depth, ctx);
			if (childrenMarkdown) {
				toggleContent += childrenMarkdown + '\n';
			}
		}
		toggleContent += '</details>';
		return toggleContent;
	}

	private async convertCalloutToMarkdown(block: NotionBlock, depth: number, ctx: ImportContext): Promise<string> {
		const icon = block.callout?.icon?.emoji || '💡';
		const calloutText = this.convertRichTextToMarkdown(block.callout?.rich_text || []);
		let calloutResult = `> [!NOTE] ${icon}\n> ${calloutText.split('\n').join('\n> ')}`;
		if ((block as any).children?.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown((block as any).children, depth, ctx);
			if (childrenMarkdown) {
				calloutResult += '\n> ' + childrenMarkdown.split('\n').join('\n> ');
			}
		}
		return calloutResult;
	}

	private async convertColumnListToMarkdown(block: NotionBlock, depth: number, ctx: ImportContext): Promise<string> {
		if ((block as any).children?.length > 0) {
			const columns = await Promise.all((block as any).children.map(async (col: NotionBlock) =>
				await this.convertBlocksToMarkdown((col as any).children || [], depth, ctx)
			));
			return columns.join('\n\n---\n\n');
		}
		return '';
	}

	private convertRichTextToMarkdown(richText: RichText[]): string {
		return richText.map(rt => {
			let text = rt.plain_text || '';

			// Handle mentions
			if (rt.type === 'mention') {
				if (rt.mention?.type === 'page') {
					const pageId = rt.mention.page?.id;
					const linkedFile = this.pageIdToFilename[pageId];
					if (linkedFile) {
						return `[[${linkedFile}]]`;
					}
				}
				// For other mentions (user, date, etc.), just use plain text
				return text;
			}

			// Handle equations
			if (rt.type === 'equation') {
				return `$${rt.equation?.expression || ''}$`;
			}

			// Apply formatting
			const annotations = rt.annotations;
			if (annotations.code) {
				text = `\`${text}\``;
			}
			if (annotations.bold) {
				text = `**${text}**`;
			}
			if (annotations.italic) {
				text = `*${text}*`;
			}
			if (annotations.strikethrough) {
				text = `~~${text}~~`;
			}

			// Handle links
			if (rt.href) {
				text = `[${text}](${rt.href})`;
			}

			return text;
		}).join('');
	}

	private async handleAttachmentBlock(block: NotionBlock, ctx: ImportContext): Promise<string> {
		const blockData = block[block.type];
		const url = blockData?.file?.url || blockData?.external?.url || '';
		const caption = this.convertRichTextToMarkdown(blockData?.caption || []);

		if (!url) {
			ctx.reportSkipped(`${block.type} attachment`, 'No URL available');
			return `<!-- ${block.type} attachment not available -->`;
		}

		// Try to download the attachment
		try {
			const downloadedPath = await this.downloadAndSaveAttachment(url, block.type, caption, ctx);
			
			if (downloadedPath) {
				if (block.type === 'image') {
					const altText = caption || 'Image from Notion';
					return `![${altText}](${downloadedPath})`;
				}
				else {
					const linkText = caption || `${block.type.toUpperCase()} File`;
					return `[${linkText}](${downloadedPath})`;
				}
			}
			else {
				// Fallback to external link if download failed
				return this.createExternalLinkFallback(block.type, caption, url);
			}
		}
		catch (error) {
			console.warn(`Failed to download ${block.type}:`, error);
			ctx.reportSkipped(`${block.type} attachment`, `Download failed: ${error.message}`);
			return this.createExternalLinkFallback(block.type, caption, url);
		}
	}

	private createExternalLinkFallback(blockType: string, caption: string, url: string): string {
		if (blockType === 'image') {
			const altText = caption || 'Image from Notion';
			return `![${altText}](${url})`;
		}
		else {
			const linkText = caption || `${blockType.toUpperCase()} from Notion`;
			return `[${linkText}](${url})`;
		}
	}

	private async downloadAndSaveAttachment(url: string, blockType: string, caption: string, ctx: ImportContext): Promise<string | null> {
		try {
			// Extract filename from URL or generate one
			const urlPath = new URL(url).pathname;
			const urlFilename = urlPath.split('/').pop() || 'attachment';
			
			// Get file extension from URL or default based on block type
			let extension = '';
			const urlExtension = urlFilename.includes('.') ? urlFilename.split('.').pop() : '';
			
			if (urlExtension) {
				extension = urlExtension;
			}
			else {
				// Default extensions based on block type
				switch (blockType) {
					case 'image': extension = 'png'; break;
					case 'audio': extension = 'mp3'; break;
					case 'video': extension = 'mp4'; break;
					case 'pdf': extension = 'pdf'; break;
					default: extension = 'bin'; break;
				}
			}

			// Generate a filename
			const baseFilename = caption ? 
				caption.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 50) : 
				`${blockType}_${Date.now()}`;
			const filename = `${baseFilename}.${extension}`;

			// Download the file
			ctx.status(`Downloading ${blockType}: ${filename}`);
			const response = await requestUrl({
				url: url,
				method: 'GET'
			});

			if (!response.arrayBuffer) {
				throw new Error('No data received');
			}

			const data = response.arrayBuffer;

			// Get the output folder path using Obsidian's attachment settings
			const outputFolder = await this.getOutputFolder();
			if (!outputFolder) {
				throw new Error('No output folder configured');
			}

			// Create a dummy source file to use getAvailablePathForAttachments
			const dummySourceFile = { parent: outputFolder } as TFile;
			const { basename } = this.parseFilename(filename);
			
			// @ts-ignore - Use Obsidian's attachment path resolution
			const attachmentPath = await this.vault.getAvailablePathForAttachments(basename, extension, dummySourceFile);
			
			// Save the file
			await this.vault.createBinary(attachmentPath, data);
			
			ctx.reportAttachmentSuccess(filename);
			
			// Return the attachment path relative to the vault
			const relativePath = attachmentPath.startsWith(outputFolder.path) ? 
				attachmentPath.substring(outputFolder.path.length + 1) : 
				attachmentPath;
			return relativePath;
		}
		catch (error) {
			console.error(`Failed to download attachment from ${url}:`, error);
			return null;
		}
	}

	private parseFilename(filename: string): { basename: string, extension: string } {
		const lastDot = filename.lastIndexOf('.');
		if (lastDot === -1) {
			return { basename: filename, extension: '' };
		}
		return {
			basename: filename.substring(0, lastDot),
			extension: filename.substring(lastDot + 1)
		};
	}

	private async convertTableToMarkdown(block: NotionBlock, ctx: ImportContext): Promise<string> {
		try {
			// Table block contains table_row children
			const tableRows = (block as any).children || [];
			
			if (tableRows.length === 0) {
				return '<!-- Empty table -->';
			}

			const markdownRows: string[] = [];
			let isFirstRow = true;

			for (const row of tableRows) {
				if (row.type === 'table_row') {
					const cells = row.table_row?.cells || [];
					const markdownCells = cells.map((cell: RichText[]) => {
						const cellText = this.convertRichTextToMarkdown(cell);
						// Escape pipe characters in cell content
						return cellText.replace(/\|/g, '\\|').replace(/\n/g, ' ');
					});

					// Ensure minimum number of cells
					while (markdownCells.length < 2) {
						markdownCells.push('');
					}

					const rowMarkdown = '| ' + markdownCells.join(' | ') + ' |';
					markdownRows.push(rowMarkdown);

					// Add separator after first row (header)
					if (isFirstRow) {
						const separator = '| ' + markdownCells.map(() => '---').join(' | ') + ' |';
						markdownRows.push(separator);
						isFirstRow = false;
					}
				}
			}

			return markdownRows.join('\n');
		}
		catch (error) {
			console.error('Error converting table:', error);
			ctx.reportSkipped('Table', `Conversion failed: ${error.message}`);
			return '<!-- Table conversion failed -->';
		}
	}

	private async generateBaseFile(database: NotionDatabase, folder: TFolder, pages: NotionPage[]): Promise<void> {
		const dbName = this.getDatabaseName(database);
		const baseFileName = sanitizeFileName(dbName) + '.base';
		const baseFilePath = normalizePath(`${folder.path}/${baseFileName}`);

		// Build base file content
		const baseContent = this.buildBaseFileContent(database);

		// Create or overwrite the base file
		try {
			const existingFile = this.vault.getAbstractFileByPath(baseFilePath);
			if (existingFile) {
				await this.vault.delete(existingFile);
			}
			await this.vault.create(baseFilePath, baseContent);
		}
		catch (error) {
			console.warn('Failed to create base file:', error);
		}
	}

	private buildBaseFileContent(database: NotionDatabase): string {
		const dbName = this.getDatabaseName(database);

		// Convert to YAML format following Kepano's patterns exactly
		const yamlLines: string[] = [];

		// Add filters using Kepano's category-based pattern
		yamlLines.push('filters:');
		yamlLines.push('  and:');
		yamlLines.push(`    - categories.contains(link("${dbName}"))`);
		yamlLines.push(`    - '!file.name.contains("Template")'`);

		yamlLines.push('');

		// Add properties configuration following Kepano's note. prefix pattern
		yamlLines.push('properties:');
		yamlLines.push('  file.name:');
		yamlLines.push('    displayName: Name');

		// Add property configurations for database properties with note. prefix
		const properties = this.getPropertiesForBase(database);
		for (const prop of properties) {
			if (prop !== 'file.name') {
				// Convert to note.property format like Kepano's bases
				const noteProperty = prop.toLowerCase().replace(/\s+/g, '');
				const propKey = `note.${noteProperty}`;
				yamlLines.push(`  ${propKey}:`);
				yamlLines.push(`    displayName: ${prop}`);
			}
		}

		yamlLines.push('');

		// Add views following Kepano's pattern
		yamlLines.push('views:');
		yamlLines.push('  - type: table');
		yamlLines.push(`    name: "All ${dbName}"`);
		yamlLines.push('    order:');
		yamlLines.push('      - file.name');

		// Add properties to the order using note. prefix
		for (const prop of properties) {
			if (prop !== 'file.name') {
				const noteProperty = prop.toLowerCase().replace(/\s+/g, '');
				yamlLines.push(`      - ${noteProperty}`);
			}
		}

		yamlLines.push('    sort:');
		yamlLines.push('      - property: file.name');
		yamlLines.push('        direction: ASC');

		return yamlLines.join('\n');
	}

	private getPropertiesForBase(database: NotionDatabase): string[] {
		const properties = ['file.name']; // Always include file name

		if (database.properties) {
			for (const [propName, prop] of Object.entries(database.properties)) {
				if ((prop as any).type !== 'title') { // Skip title as it's the file name
					properties.push(propName);
				}
			}
		}

		return properties;
	}
}
