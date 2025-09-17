/**
 * Notion Block to Obsidian Markdown Converter
 * Converts Notion blocks to Obsidian-flavored Markdown
 */

import { NotionAPIClient, NotionBlock } from './client';

export interface RichTextObject {
	type: 'text' | 'mention' | 'equation';
	text?: {
		content: string;
		link?: {
			url: string;
		};
	};
	mention?: {
		type: string;
		[key: string]: any;
	};
	equation?: {
		expression: string;
	};
	annotations: {
		bold: boolean;
		italic: boolean;
		strikethrough: boolean;
		underline: boolean;
		code: boolean;
		color: string;
	};
	plain_text: string;
	href?: string;
}

export class NotionBlockConverter {
	private attachmentPath: string;
	private singleLineBreaks: boolean;
	private downloadedFiles: Map<string, string> = new Map();

	constructor(attachmentPath: string, singleLineBreaks: boolean = false) {
		this.attachmentPath = attachmentPath;
		this.singleLineBreaks = singleLineBreaks;
	}

	async convertBlocksToMarkdown(blocks: NotionBlock[], apiClient: NotionAPIClient): Promise<string> {
		const markdownParts: string[] = [];

		for (const block of blocks) {
			const markdown = await this.convertBlock(block, apiClient);
			if (markdown.trim()) {
				markdownParts.push(markdown);
			}
		}

		const separator = this.singleLineBreaks ? '\n' : '\n\n';
		return markdownParts.join(separator);
	}

	private async convertBlock(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		switch (block.type) {
			case 'paragraph':
				return this.convertParagraph(block);
			
			case 'heading_1':
				return this.convertHeading(block, 1);
			
			case 'heading_2':
				return this.convertHeading(block, 2);
			
			case 'heading_3':
				return this.convertHeading(block, 3);
			
			case 'bulleted_list_item':
				return await this.convertBulletedListItem(block, apiClient);
			
			case 'numbered_list_item':
				return await this.convertNumberedListItem(block, apiClient);
			
			case 'to_do':
				return await this.convertToDo(block, apiClient);
			
			case 'toggle':
				return await this.convertToggle(block, apiClient);
			
			case 'quote':
				return await this.convertQuote(block, apiClient);
			
			case 'code':
				return this.convertCode(block);
			
			case 'equation':
				return this.convertEquation(block);
			
			case 'divider':
				return '---';
			
			case 'table':
				return await this.convertTable(block, apiClient);
			
			case 'table_row':
				return await this.convertTableRow(block, apiClient);
			
			case 'image':
				return await this.convertImage(block, apiClient);
			
			case 'file':
				return await this.convertFile(block, apiClient);
			
			case 'video':
				return await this.convertVideo(block, apiClient);
			
			case 'audio':
				return await this.convertAudio(block, apiClient);
			
			case 'bookmark':
				return this.convertBookmark(block);
			
			case 'embed':
				return this.convertEmbed(block);
			
			case 'link_preview':
				return this.convertLinkPreview(block);
			
			case 'callout':
				return await this.convertCallout(block, apiClient);
			
			case 'synced_block':
				return await this.convertSyncedBlock(block, apiClient);
			
			case 'table_of_contents':
				return '<!-- Table of Contents -->';
			
			case 'breadcrumb':
				return '<!-- Breadcrumb -->';
			
			case 'column_list':
			case 'column':
				return await this.convertColumns(block, apiClient);
			
			default:
				console.warn(`Unsupported block type: ${block.type}`);
				return `<!-- Unsupported block type: ${block.type} -->`;
		}
	}

	private convertParagraph(block: NotionBlock): string {
		const content = block.paragraph?.rich_text || [];
		return this.convertRichText(content);
	}

	private convertHeading(block: NotionBlock, level: number): string {
		const content = block[`heading_${level}`]?.rich_text || [];
		const text = this.convertRichText(content);
		return '#'.repeat(level) + ' ' + text;
	}

	private async convertBulletedListItem(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const content = block.bulleted_list_item?.rich_text || [];
		const text = this.convertRichText(content);
		let result = '- ' + text;

		if (block.children && block.children.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown(block.children, apiClient);
			const indentedChildren = childrenMarkdown.split('\n').map(line => '  ' + line).join('\n');
			result += '\n' + indentedChildren;
		}

		return result;
	}

	private async convertNumberedListItem(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const content = block.numbered_list_item?.rich_text || [];
		const text = this.convertRichText(content);
		let result = '1. ' + text;

		if (block.children && block.children.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown(block.children, apiClient);
			const indentedChildren = childrenMarkdown.split('\n').map(line => '   ' + line).join('\n');
			result += '\n' + indentedChildren;
		}

		return result;
	}

	private async convertToDo(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const content = block.to_do?.rich_text || [];
		const text = this.convertRichText(content);
		const checked = block.to_do?.checked ? 'x' : ' ';
		let result = `- [${checked}] ${text}`;

		if (block.children && block.children.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown(block.children, apiClient);
			const indentedChildren = childrenMarkdown.split('\n').map(line => '  ' + line).join('\n');
			result += '\n' + indentedChildren;
		}

		return result;
	}

	private async convertToggle(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const content = block.toggle?.rich_text || [];
		const text = this.convertRichText(content);
		let result = `<details>\n<summary>${text}</summary>\n`;

		if (block.children && block.children.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown(block.children, apiClient);
			result += '\n' + childrenMarkdown + '\n';
		}

		result += '</details>';
		return result;
	}

	private async convertQuote(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const content = block.quote?.rich_text || [];
		const text = this.convertRichText(content);
		let result = '> ' + text;

		if (block.children && block.children.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown(block.children, apiClient);
			const quotedChildren = childrenMarkdown.split('\n').map(line => '> ' + line).join('\n');
			result += '\n' + quotedChildren;
		}

		return result;
	}

	private convertCode(block: NotionBlock): string {
		const content = block.code?.rich_text || [];
		const text = this.convertRichText(content);
		const language = block.code?.language || '';
		return `\`\`\`${language}\n${text}\n\`\`\``;
	}

	private convertEquation(block: NotionBlock): string {
		const expression = block.equation?.expression || '';
		return `$$${expression}$$`;
	}

	private async convertTable(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		if (!block.children || block.children.length === 0) {
			return '';
		}

		const rows: string[] = [];
		const hasHeader = block.table?.has_column_header || false;

		for (let i = 0; i < block.children.length; i++) {
			const row = block.children[i];
			const rowMarkdown = await this.convertTableRow(row, apiClient);
			rows.push(rowMarkdown);

			// Add header separator after first row if it's a header
			if (i === 0 && hasHeader) {
				const cells = row.table_row?.cells || [];
				const separator = '|' + cells.map(() => ' --- ').join('|') + '|';
				rows.push(separator);
			}
		}

		return rows.join('\n');
	}

	private async convertTableRow(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const cells = block.table_row?.cells || [];
		const cellContents = cells.map((cell: RichTextObject[]) => {
			return this.convertRichText(cell).replace(/\|/g, '\\|'); // Escape pipes in table cells
		});
		return '| ' + cellContents.join(' | ') + ' |';
	}

	private async convertImage(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const image = block.image;
		if (!image) return '';

		let url = '';
		let caption = '';

		if (image.type === 'external') {
			url = image.external?.url || '';
		} else if (image.type === 'file') {
			url = image.file?.url || '';
		}

		if (image.caption && image.caption.length > 0) {
			caption = this.convertRichText(image.caption);
		}

		if (url) {
			try {
				// Download the image
				const filename = await this.downloadFile(url, apiClient, 'image');
				return `![${caption}](${filename})`;
			} catch (error) {
				console.warn('Failed to download image:', error);
				return `![${caption}](${url})`;
			}
		}

		return '';
	}

	private async convertFile(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const file = block.file;
		if (!file) return '';

		let url = '';
		let name = '';

		if (file.type === 'external') {
			url = file.external?.url || '';
			name = file.name || 'External File';
		} else if (file.type === 'file') {
			url = file.file?.url || '';
			name = file.name || 'File';
		}

		if (url) {
			try {
				// Download the file
				const filename = await this.downloadFile(url, apiClient, 'file', name);
				return `[${name}](${filename})`;
			} catch (error) {
				console.warn('Failed to download file:', error);
				return `[${name}](${url})`;
			}
		}

		return '';
	}

	private async convertVideo(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const video = block.video;
		if (!video) return '';

		let url = '';

		if (video.type === 'external') {
			url = video.external?.url || '';
		} else if (video.type === 'file') {
			url = video.file?.url || '';
		}

		if (url) {
			// For external videos (YouTube, etc.), just return the link
			if (video.type === 'external') {
				return `[Video](${url})`;
			}

			try {
				// Download video files
				const filename = await this.downloadFile(url, apiClient, 'video');
				return `[Video](${filename})`;
			} catch (error) {
				console.warn('Failed to download video:', error);
				return `[Video](${url})`;
			}
		}

		return '';
	}

	private async convertAudio(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const audio = block.audio;
		if (!audio) return '';

		let url = '';

		if (audio.type === 'external') {
			url = audio.external?.url || '';
		} else if (audio.type === 'file') {
			url = audio.file?.url || '';
		}

		if (url) {
			try {
				// Download audio files
				const filename = await this.downloadFile(url, apiClient, 'audio');
				return `[Audio](${filename})`;
			} catch (error) {
				console.warn('Failed to download audio:', error);
				return `[Audio](${url})`;
			}
		}

		return '';
	}

	private convertBookmark(block: NotionBlock): string {
		const bookmark = block.bookmark;
		if (!bookmark) return '';

		const url = bookmark.url || '';
		const caption = bookmark.caption && bookmark.caption.length > 0 
			? this.convertRichText(bookmark.caption)
			: url;

		return `[${caption}](${url})`;
	}

	private convertEmbed(block: NotionBlock): string {
		const embed = block.embed;
		if (!embed) return '';

		const url = embed.url || '';
		return `[Embed](${url})`;
	}

	private convertLinkPreview(block: NotionBlock): string {
		const linkPreview = block.link_preview;
		if (!linkPreview) return '';

		const url = linkPreview.url || '';
		return `[Link Preview](${url})`;
	}

	private async convertCallout(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		const callout = block.callout;
		if (!callout) return '';

		const icon = callout.icon?.emoji || '💡';
		const content = callout.rich_text || [];
		const text = this.convertRichText(content);

		let result = `> ${icon} ${text}`;

		if (block.children && block.children.length > 0) {
			const childrenMarkdown = await this.convertBlocksToMarkdown(block.children, apiClient);
			const quotedChildren = childrenMarkdown.split('\n').map(line => '> ' + line).join('\n');
			result += '\n' + quotedChildren;
		}

		return result;
	}

	private async convertSyncedBlock(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		// Synced blocks contain the actual content in their children
		if (block.children && block.children.length > 0) {
			return await this.convertBlocksToMarkdown(block.children, apiClient);
		}
		return '';
	}

	private async convertColumns(block: NotionBlock, apiClient: NotionAPIClient): Promise<string> {
		if (block.type === 'column_list' && block.children) {
			// Convert each column
			const columnContents: string[] = [];
			for (const column of block.children) {
				if (column.children) {
					const columnMarkdown = await this.convertBlocksToMarkdown(column.children, apiClient);
					columnContents.push(columnMarkdown);
				}
			}
			
			// Simple approach: just concatenate columns with a separator
			return columnContents.join('\n\n---\n\n');
		}

		if (block.type === 'column' && block.children) {
			return await this.convertBlocksToMarkdown(block.children, apiClient);
		}

		return '';
	}

	private convertRichText(richTextArray: RichTextObject[]): string {
		return richTextArray.map(richText => {
			let text = richText.plain_text;

			// Apply formatting
			if (richText.annotations.bold) {
				text = `**${text}**`;
			}
			if (richText.annotations.italic) {
				text = `*${text}*`;
			}
			if (richText.annotations.strikethrough) {
				text = `~~${text}~~`;
			}
			if (richText.annotations.code) {
				text = `\`${text}\``;
			}
			if (richText.annotations.underline) {
				text = `<u>${text}</u>`;
			}

			// Handle links
			if (richText.href || richText.text?.link?.url) {
				const url = richText.href || richText.text?.link?.url;
				text = `[${text}](${url})`;
			}

			// Handle mentions and equations
			if (richText.type === 'mention') {
				// For now, just return the plain text
				// Could be enhanced to handle different mention types
				return text;
			}

			if (richText.type === 'equation') {
				return `$${richText.equation?.expression || text}$`;
			}

			return text;
		}).join('');
	}

	private async downloadFile(url: string, apiClient: NotionAPIClient, type: string, originalName?: string): Promise<string> {
		// Check if we've already downloaded this file
		if (this.downloadedFiles.has(url)) {
			return this.downloadedFiles.get(url)!;
		}

		try {
			const data = await apiClient.downloadFile(url);
			
			// Generate filename
			const extension = this.getFileExtension(url, type);
			const baseName = originalName ? this.sanitizeFileName(originalName) : `${type}_${Date.now()}`;
			const filename = `${baseName}${extension}`;
			
			// In a real implementation, you would save the file to the vault
			// For now, we'll just return the filename
			const filePath = this.attachmentPath ? `${this.attachmentPath}/${filename}` : filename;
			
			// Cache the result
			this.downloadedFiles.set(url, filePath);
			
			return filePath;
		} catch (error) {
			console.error('Failed to download file:', error);
			throw error;
		}
	}

	private getFileExtension(url: string, type: string): string {
		// Try to extract extension from URL
		const urlParts = url.split('?')[0].split('.');
		if (urlParts.length > 1) {
			return '.' + urlParts[urlParts.length - 1];
		}

		// Fallback based on type
		switch (type) {
			case 'image':
				return '.png';
			case 'video':
				return '.mp4';
			case 'audio':
				return '.mp3';
			default:
				return '.bin';
		}
	}

	private sanitizeFileName(name: string): string {
		return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
	}
}