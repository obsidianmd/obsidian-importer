import { normalizePath, Notice, Setting, DataWriteOptions, TFile } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { NotionWorkspace } from './notion-api/workspace-client';
import { NotionMarkdownRenderer } from './notion-api/markdown-renderer';
import { ObsidianBaseBuilder } from './notion-api/base-builder';

export class NotionApiImporter extends FormatImporter {
	private apiKey: string = '';
	private selectedWorkspaces: string[] = [];
	private mediaPath: string = '';

	init() {
		this.addOutputLocationSetting('Notion Workspace');
		
		// API key input - users need to create an integration first
		new Setting(this.modal.contentEl)
			.setName('Notion API Key')
			.setDesc('Get your API key from https://www.notion.so/my-integrations (create an integration first)')
			.addText((text) => text
				.setPlaceholder('secret_...')
				.setValue(this.apiKey)
				.onChange((value) => this.apiKey = value));

		// Workspace discovery - this will populate after API key is entered
		const workspaceSetting = new Setting(this.modal.contentEl)
			.setName('Available Workspaces')
			.setDesc('Select which workspaces to import from')
			.addButton((button) => button
				.setButtonText('Discover Workspaces')
				.setCta()
				.onClick(async () => {
					if (!this.apiKey.trim()) {
						new Notice('Please enter your Notion API key first');
						return;
					}
					await this.discoverWorkspaces();
				}));

		// Media handling - where to store downloaded files
		new Setting(this.modal.contentEl)
			.setName('Media Storage Path')
			.setDesc('Where to store downloaded images, videos, and files')
			.addText((text) => text
				.setPlaceholder('media')
				.setValue(this.mediaPath || 'media')
				.onChange((value) => this.mediaPath = value));
	}

	private async discoverWorkspaces() {
		try {
			const workspace = new NotionWorkspace(this.apiKey);
			const availableWorkspaces = await workspace.fetchAvailableWorkspaces();
			
			// Clean up any existing workspace toggles
			const existingToggles = this.modal.contentEl.querySelectorAll('.workspace-toggle');
			existingToggles.forEach(el => el.remove());

			// Create toggles for each discovered workspace
			availableWorkspaces.forEach(ws => {
				const setting = new Setting(this.modal.contentEl);
				setting.setName(ws.title);
				setting.setDesc(`Workspace ID: ${ws.id} • ${ws.pageCount} pages`);
				setting.addToggle((toggle: any) => toggle
					.setValue(this.selectedWorkspaces.includes(ws.id))
					.onChange((value: any) => {
						if (value) {
							this.selectedWorkspaces.push(ws.id);
						} else {
							this.selectedWorkspaces = this.selectedWorkspaces.filter(id => id !== ws.id);
						}
					}));
			});

			new Notice(`Discovered ${availableWorkspaces.length} workspaces`);
		} catch (error) {
			new Notice(`Failed to discover workspaces: ${error.message}`);
		}
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.apiKey.trim()) {
			new Notice('Please enter your Notion API key');
			return;
		}

		if (this.selectedWorkspaces.length === 0) {
			new Notice('Please select at least one workspace to import');
			return;
		}

		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to');
			return;
		}

		const workspace = new NotionWorkspace(this.apiKey);
		const markdownRenderer = new NotionMarkdownRenderer(workspace, this.mediaPath);
		const baseBuilder = new ObsidianBaseBuilder();

		ctx.status('Starting Notion workspace import...');

		for (const workspaceId of this.selectedWorkspaces) {
			if (ctx.isCancelled()) return;

			try {
				ctx.status(`Processing workspace ${workspaceId}`);
				
				// Fetch workspace structure and databases
				const workspaceData = await workspace.fetchWorkspaceStructure(workspaceId);
				const databases = workspaceData.databases;
				
				// Create .base files for each database
				for (const db of databases) {
					const baseContent = baseBuilder.buildBaseFile(db, workspaceData.dataSources);
					const basePath = `${outputFolder.path}/${this.sanitizeFilename(db.title)}.base`;
					await this.app.vault.create(basePath, baseContent);
				}

				// Import all pages from this workspace
				const allPages = await workspace.fetchAllPages(workspaceId);
				
				for (const page of allPages) {
					if (ctx.isCancelled()) return;

					try {
						ctx.status(`Converting: ${page.title || 'Untitled Page'}`);
						
						// Render page content to markdown
						const markdownContent = await markdownRenderer.renderPage(page);
						
						// Save the markdown file
						const filename = this.sanitizeFilename(page.title || 'Untitled Page');
						const filePath = `${outputFolder.path}/${filename}.md`;
						
						await this.app.vault.create(filePath, markdownContent);
						ctx.reportNoteSuccess(filePath);
						
					} catch (error) {
						ctx.reportFailed(`Page ${page.id}`, error);
					}
				}

			} catch (error) {
				ctx.reportFailed(`Workspace ${workspaceId}`, error);
			}
		}

		ctx.status('Import completed successfully!');
	}

	private sanitizeFilename(name: string): string {
		// Clean up filename for filesystem compatibility
		return name
			.replace(/[<>:"/\\|?*]/g, '_')
			.replace(/\s+/g, '_')
			.replace(/_{2,}/g, '_') // collapse multiple underscores
			.substring(0, 100);
	}
}
