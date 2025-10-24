import { Notice, Setting, normalizePath, requestUrl } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { Client, PageObjectResponse } from '@notionhq/client';
import { sanitizeFileName, serializeFrontMatter } from '../util';

// Import helper modules
import { extractPageId } from './notion-api/utils';
import { 
	makeNotionRequest, 
	fetchAllBlocks, 
	extractPageTitle, 
	extractFrontMatter 
} from './notion-api/api-helpers';
import { convertBlocksToMarkdown } from './notion-api/block-converter';
import { pageExistsInVault, getUniqueFolderPath } from './notion-api/vault-helpers';
import { processDatabasePlaceholders } from './notion-api/database-helpers';

export type FormulaImportStrategy = 'static' | 'function' | 'hybrid';

export class NotionAPIImporter extends FormatImporter {
	notionToken: string = '';
	pageId: string = '';
	formulaStrategy: FormulaImportStrategy = 'function'; // Default strategy
	private notionClient: Client | null = null;
	private processedPages: Set<string> = new Set();
	private requestCount: number = 0;
    // save output root path for database handling
    //  we will flatten all database in this folder later
	private outputRootPath: string = '';

	init() {
		// No file chooser needed since we're importing via API
		this.addOutputLocationSetting('Notion API Import');

		// Notion API Token input
		new Setting(this.modal.contentEl)
			.setName('Notion API Token')
			.setDesc(this.createTokenDescription())
			.addText(text => text
				.setPlaceholder('secret_...')
				.setValue(this.notionToken)
				.onChange(value => {
					this.notionToken = value.trim();
				})
				.then(textComponent => {
					// Set as password input
					textComponent.inputEl.type = 'password';
				}));

		// Page ID input
		new Setting(this.modal.contentEl)
			.setName('Page ID')
			.setDesc(this.createPageIdDescription())
			.addText(text => text
				.setPlaceholder('Enter Notion page ID Or Page URL')
				.setValue(this.pageId)
				.onChange(value => {
					this.pageId = value.trim();
				}));

		// Formula import strategy
		new Setting(this.modal.contentEl)
			.setName('Formula import strategy')
			.setDesc(this.createFormulaStrategyDescription())
			.addDropdown(dropdown => dropdown
				.addOption('static', 'Static values (YAML only)')
				.addOption('function', 'Base functions (default)')
				.addOption('hybrid', 'Hybrid (functions + fallback to static)')
				.setValue(this.formulaStrategy)
				.onChange(value => {
					this.formulaStrategy = value as FormulaImportStrategy;
				}));

		// Description text
		new Setting(this.modal.contentEl)
			.setName('Import notes')
			.setDesc(this.createImportDescription())
			.setHeading();
	}

	private createTokenDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Enter your Notion integration token. ');
		frag.createEl('a', {
			text: 'Learn how to get your token',
			href: 'https://developers.notion.com/docs/create-a-notion-integration',
		});
		frag.appendText('.');
		return frag;
	}

	private createFormulaStrategyDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Choose how to import Notion formulas: ');
		frag.createEl('br');
		frag.appendText('• Static: Formula results as text in page YAML');
		frag.createEl('br');
		frag.appendText('• Function: Convert to Base functions (may fail for complex formulas)');
		frag.createEl('br');
		frag.appendText('• Hybrid: Try functions, fallback to static for complex formulas');
		return frag;
	}

	private createPageIdDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Enter the ID of the page you want to import. You can paste the full URL or just the ID. ');
		frag.createEl('a', {
			text: 'Learn how to find your page ID',
			href: 'https://developers.notion.com/docs/working-with-page-content#creating-a-page-with-content',
		});
		frag.appendText('.');
		return frag;
	}

	private createImportDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		const ul = frag.createEl('ul');
		
		// Attachment handling
		ul.createEl('li', { 
			text: 'Attachments, videos (non-YouTube), audio, images, and files from Notion will be placed according to your vault\'s attachment folder settings.' 
		});
		
		// File structure explanation
		const structureLi = ul.createEl('li');
		structureLi.appendText('Due to differences between Notion and Obsidian\'s file systems, Notion Pages and Databases will be represented as folders in Obsidian. ');
		structureLi.appendText('Page content will be stored in a ');
		structureLi.createEl('code', { text: 'Content.md' });
		structureLi.appendText(' file within the folder. If a Page contains Databases, they will be rendered as links in ');
		structureLi.createEl('code', { text: 'Content.md' });
		structureLi.appendText(', pointing to ');
		structureLi.createEl('code', { text: '.base' });
		structureLi.appendText(' files (Notion databases in Obsidian format with filter conditions) under the Page folder.');
		
		// API rate limit warning
		ul.createEl('li', { 
			text: 'Due to Notion API rate limits, importing large workspaces may take considerable time. Please be patient.' 
		});
		
		return frag;
	}

	async import(ctx: ImportContext): Promise<void> {
		// Validate inputs
		if (!this.notionToken) {
			new Notice('Please enter your Notion API token.');
			return;
		}

		if (!this.pageId) {
			new Notice('Please enter a Notion page ID.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		// Extract Page ID (if user pasted full URL)
		const extractedPageId = extractPageId(this.pageId);
		if (!extractedPageId) {
			new Notice('Invalid page ID or URL format.');
			return;
		}

		ctx.status('Connecting to Notion API...');

		try {
			// Initialize Notion client with latest API version
			// Using 2025-09-03 for better database/data source support
			// Use Obsidian's requestUrl instead of fetch to avoid context issues in some environments
			this.notionClient = new Client({ 
				auth: this.notionToken,
				notionVersion: '2025-09-03',
				fetch: async (url: RequestInfo | URL, init?: RequestInit) => { // we need custom fetch to avoid context issues in some environments
					const urlString = url.toString();
					
					try {
						const response = await requestUrl({
							url: urlString,
							method: (init?.method as any) || 'GET',
							headers: init?.headers as Record<string, string>,
							body: init?.body as string | ArrayBuffer,
							throw: false,
						});
						
						// Convert Obsidian response to fetch Response format
						return new Response(response.arrayBuffer, {
							status: response.status,
							statusText: response.status.toString(),
							headers: new Headers(response.headers),
						});
					}
					catch (error) {
						console.error('Request failed:', error);
						throw error;
					}
				},
			});

			ctx.status('Fetching page content from Notion...');
			
			// Reset processed pages tracker
			this.processedPages.clear();
			
			// Save output root path for database handling
			this.outputRootPath = folder.path;
			
			// Start importing from the root page
			await this.fetchAndImportPage(ctx, extractedPageId, folder.path);
			
		}
		catch (error) {
			console.error('Notion API import error:', error);
			ctx.reportFailed('Notion API import', error);
			new Notice(`Import failed: ${error.message}`);
		}
	}

	/**
	 * Fetch and import a Notion page recursively
	 */
	private async fetchAndImportPage(ctx: ImportContext, pageId: string, parentPath: string): Promise<void> {
		if (ctx.isCancelled()) return;
		
		// Check if already processed
		if (this.processedPages.has(pageId)) {
			ctx.reportSkipped(pageId, 'already processed');
			return;
		}
		
		this.processedPages.add(pageId);
		
		try {
			ctx.status(`Fetching page ${pageId}...`);
			
			// Fetch page metadata with rate limit handling
			const page = await makeNotionRequest(
				() => this.notionClient!.pages.retrieve({ page_id: pageId }) as Promise<PageObjectResponse>,
				ctx
			);
			
			// Extract page title
			const pageTitle = extractPageTitle(page);
			const sanitizedTitle = sanitizeFileName(pageTitle || 'Untitled');
			
			// Check if page already exists in vault (by notion-id)
			if (await pageExistsInVault(this.app, this.vault, pageId)) {
				ctx.reportSkipped(sanitizedTitle, 'already exists in vault (notion-id match)');
				return;
			}
			
			// Create page folder with unique name
			const pageFolderPath = getUniqueFolderPath(this.vault, parentPath, sanitizedTitle);
			await this.createFolders(pageFolderPath);
			
			// Fetch page blocks (content) with rate limit handling
			const blocks = await fetchAllBlocks(this.notionClient!, pageId, ctx);
			
			// Convert blocks to markdown with nested children support
			let markdownContent = await convertBlocksToMarkdown(blocks, ctx, pageFolderPath, this.notionClient!);
			
			// Process database placeholders
			markdownContent = await processDatabasePlaceholders(
				markdownContent,
				blocks,
				ctx,
				pageFolderPath,
				this.notionClient!,
				this.vault,
				this.app,
				this.outputRootPath,
				// Callback to import database pages
				async (pageId: string, parentPath: string) => {
					await this.fetchAndImportPage(ctx, pageId, parentPath);
				}
			);
			
			// Prepare YAML frontmatter
			const frontMatter = extractFrontMatter(page);
			
			// Create the markdown file
			const mdFilePath = `${pageFolderPath}/${sanitizedTitle}.md`;
			const fullContent = serializeFrontMatter(frontMatter) + markdownContent;
			
			await this.vault.create(normalizePath(mdFilePath), fullContent);
			ctx.reportNoteSuccess(sanitizedTitle);
			
		}
		catch (error) {
			console.error(`Failed to import page ${pageId}:`, error);
			ctx.reportFailed(pageId, error.message);
		}
	}
	
}
