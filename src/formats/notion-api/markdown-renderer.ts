import { NotionWorkspace, WorkspacePage } from './workspace-client';

// Handles conversion of Notion content to Obsidian markdown
export class NotionMarkdownRenderer {
	private workspace: NotionWorkspace;
	private mediaPath: string;

	constructor(workspace: NotionWorkspace, mediaPath: string = 'media') {
		this.workspace = workspace;
		this.mediaPath = mediaPath;
	}

	async renderPage(page: WorkspacePage): Promise<string> {
		const blocks = await this.workspace.fetchPageContent(page.id);
		const markdown = await this.renderBlocks(blocks);
		
		// Add frontmatter with page metadata
		const frontmatter = this.createFrontmatter(page);
		return `${frontmatter}\n\n${markdown}`;
	}

	private async renderBlocks(blocks: any[]): Promise<string> {
		let markdown = '';

		for (const block of blocks) {
			const blockMarkdown = await this.renderBlock(block);
			if (blockMarkdown) {
				markdown += blockMarkdown + '\n\n';
			}
		}

		return markdown.trim();
	}

	private async renderBlock(block: any): Promise<string> {
		const type = block.type;

		switch (type) {
			// Text blocks
			case 'paragraph':
				return this.convertRichText(block.paragraph.rich_text);
			
			case 'heading_1':
				return `# ${this.convertRichText(block.heading_1.rich_text)}`;
			
			case 'heading_2':
				return `## ${this.convertRichText(block.heading_2.rich_text)}`;
			
			case 'heading_3':
				return `### ${this.convertRichText(block.heading_3.rich_text)}`;
			
			// List blocks
			case 'bulleted_list_item':
				return `- ${this.convertRichText(block.bulleted_list_item.rich_text)}`;
			
			case 'numbered_list_item':
				return `1. ${this.convertRichText(block.numbered_list_item.rich_text)}`;
			
			case 'to_do':
				const checked = block.to_do.checked ? 'x' : ' ';
				return `- [${checked}] ${this.convertRichText(block.to_do.rich_text)}`;
			
			case 'toggle':
				return `- ${this.convertRichText(block.toggle.rich_text)}`;
			
			// Code blocks
			case 'code':
				const language = block.code.language || '';
				const code = this.convertRichText(block.code.rich_text);
				return `\`\`\`${language}\n${code}\n\`\`\``;
			
			// Quote and callout blocks
			case 'quote':
				return `> ${this.convertRichText(block.quote.rich_text)}`;
			
			case 'callout':
				const icon = block.callout.icon?.emoji || '💡';
				const calloutText = this.convertRichText(block.callout.rich_text);
				return `> [!${icon}] ${calloutText}`;
			
			// Divider
			case 'divider':
				return '---';
			
			// Media blocks
			case 'image':
				return await this.convertImage(block.image);
			
			case 'file':
				return await this.convertFile(block.file);
			
			case 'video':
				return await this.convertVideo(block.video);
			
			case 'audio':
				return await this.convertAudio(block.audio);
			
			case 'pdf':
				return await this.convertPdf(block.pdf);
			
			// Table blocks
			case 'table':
				return this.convertTable(block.table);
			
			case 'table_row':
				return this.convertTableRow(block.table_row);
			
			// Equation blocks
			case 'equation':
				return `$$\n${block.equation.expression}\n$$`;
			
			// Embed blocks
			case 'embed':
				return `[Embed: ${block.embed.url}](${block.embed.url})`;
			
			case 'bookmark':
				return `[Bookmark: ${block.bookmark.url}](${block.bookmark.url})`;
			
			case 'link_preview':
				return `[Link Preview: ${block.link_preview.url}](${block.link_preview.url})`;
			
			// Database blocks
			case 'child_database':
				return `[[Database: ${block.child_database.title}]]`;
			
			case 'child_page':
				return `[[Page: ${block.child_page.title}]]`;
			
			// Synced blocks
			case 'synced_block':
				return `<!-- Synced Block: ${block.synced_block.synced_from?.block_id || 'local'} -->`;
			
			// Column blocks
			case 'column_list':
				return '<!-- Column List -->';
			
			case 'column':
				return '<!-- Column -->';
			
			// Breadcrumb
			case 'breadcrumb':
				return '<!-- Breadcrumb -->';
			
			// Template
			case 'template':
				return `<!-- Template: ${this.convertRichText(block.template.rich_text)} -->`;
			
			// Link to page
			case 'link_to_page':
				return `[[${block.link_to_page.page_id}]]`;
			
			default:
				// Handle unknown block types
				if (block[type]?.rich_text) {
					return this.convertRichText(block[type].rich_text);
				}
				return '';
		}
	}

	private convertRichText(richText: any[]): string {
		if (!Array.isArray(richText)) return '';

		return richText.map(text => {
			let content = text.plain_text || '';
			
			// Apply formatting
			if (text.annotations) {
				if (text.annotations.bold) content = `**${content}**`;
				if (text.annotations.italic) content = `*${content}*`;
				if (text.annotations.strikethrough) content = `~~${content}~~`;
				if (text.annotations.code) content = `\`${content}\``;
			}

			// Handle links
			if (text.href) {
				content = `[${content}](${text.href})`;
			}

			return content;
		}).join('');
	}

	private async convertImage(imageBlock: any): Promise<string> {
		const image = imageBlock;
		if (!image.url) return '';

		try {
			// Download the image
			const fileName = await this.downloadAttachment(image.url, 'image');
			return `![](${this.mediaPath}/${fileName})`;
		} catch (error) {
			console.warn('Failed to download image:', error);
			return `![Image](${image.url})`;
		}
	}

	private async convertFile(fileBlock: any): Promise<string> {
		const file = fileBlock;
		if (!file.url) return '';

		try {
			// Download the file
			const fileName = await this.downloadAttachment(file.url, 'file');
			return `[${file.name || 'File'}](${this.mediaPath}/${fileName})`;
		} catch (error) {
			console.warn('Failed to download file:', error);
			return `[${file.name || 'File'}](${file.url})`;
		}
	}

	private async convertVideo(videoBlock: any): Promise<string> {
		const video = videoBlock;
		if (!video.url) return '';

		try {
			// Download the video
			const fileName = await this.downloadAttachment(video.url, 'video');
			return `[Video](${this.mediaPath}/${fileName})`;
		} catch (error) {
			console.warn('Failed to download video:', error);
			return `[Video](${video.url})`;
		}
	}

	private async convertAudio(audioBlock: any): Promise<string> {
		const audio = audioBlock;
		if (!audio.url) return '';

		try {
			// Download the audio
			const fileName = await this.downloadAttachment(audio.url, 'audio');
			return `[Audio](${this.mediaPath}/${fileName})`;
		} catch (error) {
			console.warn('Failed to download audio:', error);
			return `[Audio](${audio.url})`;
		}
	}

	private async convertPdf(pdfBlock: any): Promise<string> {
		const pdf = pdfBlock;
		if (!pdf.url) return '';

		try {
			// Download the PDF
			const fileName = await this.downloadAttachment(pdf.url, 'pdf');
			return `[PDF](${this.mediaPath}/${fileName})`;
		} catch (error) {
			console.warn('Failed to download PDF:', error);
			return `[PDF](${pdf.url})`;
		}
	}

	private convertTable(tableBlock: any): string {
		// Table conversion is complex and would need to handle table rows
		// For now, return a placeholder
		return '<!-- Table content would be here -->';
	}

	private convertTableRow(tableRowBlock: any): string {
		// Table row conversion
		const cells = tableRowBlock.cells.map((cell: any) => 
			this.convertRichText(cell)
		);
		return '| ' + cells.join(' | ') + ' |';
	}

	private async downloadAttachment(url: string, type: string): Promise<string> {
		// This is a simplified version - in production, you'd want to:
		// 1. Check if file already exists
		// 2. Handle different file types properly
		// 3. Use proper error handling
		// 4. Respect rate limits
		
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download ${type}: ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		const extension = this.getFileExtension(url);
		const fileName = `${type}_${Date.now()}${extension}`;
		
		// In a real implementation, you'd save this to the vault
		// For now, we'll just return the filename
		return fileName;
	}

	private getFileExtension(url: string): string {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;
			const extension = pathname.split('.').pop();
			return extension ? `.${extension}` : '';
		} catch {
			return '';
		}
	}

	private createFrontmatter(page: WorkspacePage): string {
		return `---
notion_id: ${page.id}
title: ${page.title}
imported_from: notion
created: ${page.created_time}
modified: ${page.last_edited_time}
---`;
	}
}
