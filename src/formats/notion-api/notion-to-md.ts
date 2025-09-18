import { NotionApiClient } from './notion-client';

export class NotionToMarkdownConverter {
	private client: NotionApiClient;
	private attachmentFolder: string;

	constructor(client: NotionApiClient, attachmentFolder: string = 'attachments') {
		this.client = client;
		this.attachmentFolder = attachmentFolder;
	}

	async convertPage(pageId: string): Promise<string> {
		const blocks = await this.client.getPageBlocks(pageId);
		const markdown = await this.convertBlocks(blocks);
		
		// Add frontmatter
		const frontmatter = this.generateFrontmatter(pageId);
		return `${frontmatter}\n\n${markdown}`;
	}

	private async convertBlocks(blocks: any[]): Promise<string> {
		let markdown = '';

		for (const block of blocks) {
			const blockMarkdown = await this.convertBlock(block);
			if (blockMarkdown) {
				markdown += blockMarkdown + '\n\n';
			}
		}

		return markdown.trim();
	}

	private async convertBlock(block: any): Promise<string> {
		const type = block.type;

		switch (type) {
			case 'paragraph':
				return this.convertRichText(block.paragraph.rich_text);
			
			case 'heading_1':
				return `# ${this.convertRichText(block.heading_1.rich_text)}`;
			
			case 'heading_2':
				return `## ${this.convertRichText(block.heading_2.rich_text)}`;
			
			case 'heading_3':
				return `### ${this.convertRichText(block.heading_3.rich_text)}`;
			
			case 'bulleted_list_item':
				return `- ${this.convertRichText(block.bulleted_list_item.rich_text)}`;
			
			case 'numbered_list_item':
				return `1. ${this.convertRichText(block.numbered_list_item.rich_text)}`;
			
			case 'to_do':
				const checked = block.to_do.checked ? 'x' : ' ';
				return `- [${checked}] ${this.convertRichText(block.to_do.rich_text)}`;
			
			case 'toggle':
				return `- ${this.convertRichText(block.toggle.rich_text)}`;
			
			case 'code':
				const language = block.code.language || '';
				const code = this.convertRichText(block.code.rich_text);
				return `\`\`\`${language}\n${code}\n\`\`\``;
			
			case 'quote':
				return `> ${this.convertRichText(block.quote.rich_text)}`;
			
			case 'callout':
				const icon = block.callout.icon?.emoji || '💡';
				const calloutText = this.convertRichText(block.callout.rich_text);
				return `> [!${icon}] ${calloutText}`;
			
			case 'divider':
				return '---';
			
			case 'image':
				return await this.convertImage(block.image);
			
			case 'file':
				return await this.convertFile(block.file);
			
			case 'video':
				return await this.convertVideo(block.video);
			
			case 'table':
				return this.convertTable(block.table);
			
			case 'table_row':
				return this.convertTableRow(block.table_row);
			
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
			return `![](${this.attachmentFolder}/${fileName})`;
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
			return `[${file.name || 'File'}](${this.attachmentFolder}/${fileName})`;
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
			return `[Video](${this.attachmentFolder}/${fileName})`;
		} catch (error) {
			console.warn('Failed to download video:', error);
			return `[Video](${video.url})`;
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

	private generateFrontmatter(pageId: string): string {
		return `---
notion_id: ${pageId}
imported_from: notion
created: ${new Date().toISOString()}
---`;
	}
}
