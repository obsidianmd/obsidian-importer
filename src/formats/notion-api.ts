import { Notice, Setting } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

export class NotionAPIImporter extends FormatImporter {
	notionToken: string = '';
	pageId: string = '';

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
		const extractedPageId = this.extractPageId(this.pageId);
		if (!extractedPageId) {
			new Notice('Invalid page ID or URL format.');
			return;
		}

		ctx.status('Connecting to Notion API...');

		try {
			// TODO: Implement Notion API call logic
			// This is placeholder code, actual implementation needs:
			// 1. Call Notion API to get page content
			// 2. Recursively get child pages
			// 3. Download attachments
			// 4. Convert to Markdown
			// 5. Save to vault

			ctx.status('Fetching page content from Notion...');
			
			// Example progress reporting
			ctx.reportProgress(0, 1);
			
			// Add actual API call code here
			await this.fetchAndImportPage(ctx, extractedPageId, folder.path);
			
			ctx.reportProgress(1, 1);
			
		}
		catch (error) {
			console.error('Notion API import error:', error);
			ctx.reportFailed('Notion API import', error);
			new Notice(`Import failed: ${error.message}`);
		}
	}

	/**
	 * Extract Page ID from URL or direct ID input
	 * Supported formats:
	 * - https://www.notion.so/Page-Title-abc123def456
	 * - https://www.notion.so/workspace/Page-Title-abc123def456?v=xxx
	 * - abc123def456
	 * - abc123def456789012345678901234567890
	 */
	private extractPageId(input: string): string | null {
		// Remove whitespace
		input = input.trim();

		// If it's a URL, extract ID
		if (input.startsWith('http')) {
			// Remove query parameters
			const urlWithoutQuery = input.split('?')[0];
			
			// Find the last dash
			const lastDashIndex = urlWithoutQuery.lastIndexOf('-');
			
			if (lastDashIndex !== -1) {
				// Extract 32 characters after the dash
				const pageId = urlWithoutQuery.substring(lastDashIndex + 1);
				
				// Validate it's 32 hex characters
				if (pageId.length === 32 && /^[a-f0-9]{32}$/i.test(pageId)) {
					return this.formatPageId(pageId);
				}
			}
			
			return null;
		}
		else {
			// Direct ID input
			return this.formatPageId(input);
		}
	}

	/**
	 * Format Page ID to standard UUID format (with dashes)
	 */
	private formatPageId(id: string): string {
		// Remove all dashes
		id = id.replace(/-/g, '');

		// If length is not 32, return original (possibly invalid)
		if (id.length !== 32) {
			return id;
		}

		// Format as UUID: 8-4-4-4-12
		return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
	}

	/**
	 * Fetch and import page (placeholder method)
	 */
	private async fetchAndImportPage(ctx: ImportContext, pageId: string, outputPath: string): Promise<void> {
		// TODO: Implement actual Notion API calls
		// This needs:
		// 1. Use @notionhq/client or direct fetch to call Notion API, handle pagination and rate limiting like 429 error.
		// 2. Get page content and child pages
		// 3. Convert to Markdown
		// 4. Save files

		ctx.status(`Fetching page ${pageId}...`);
		
		// Placeholder implementation
		throw new Error('Notion API integration is not yet implemented. This is a placeholder for future development.');
	}
}

