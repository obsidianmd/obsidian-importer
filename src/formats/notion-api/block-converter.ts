import type {
	BlockObjectResponse,
	RichTextItemResponse,
	ListBlockChildrenResponse,
} from '@notionhq/client/build/src/api-endpoints';
import type { NotionApiClient } from './api-client';
import type { Vault } from 'obsidian';

interface ConversionContext {
	vault: Vault;
	client: NotionApiClient;
	attachmentFolder: string;
	indentLevel: number;
	listCounters: Map<number, number>;
}

export class BlockConverter {
	private client: NotionApiClient;
	private vault: Vault;
	private attachmentFolder: string;

	constructor(client: NotionApiClient, vault: Vault, attachmentFolder: string) {
		this.client = client;
		this.vault = vault;
		this.attachmentFolder = attachmentFolder;
	}

	async convertBlocksToMarkdown(blockId: string): Promise<string> {
		const context: ConversionContext = {
			vault: this.vault,
			client: this.client,
			attachmentFolder: this.attachmentFolder,
			indentLevel: 0,
			listCounters: new Map(),
		};

		const blocks = await this.client.getAllBlockChildren(blockId);
		return this.convertBlockList(blocks, context);
	}

	private async convertBlockList(
		blocks: ListBlockChildrenResponse['results'],
		context: ConversionContext
	): Promise<string> {
		const lines: string[] = [];
		let previousBlockType: string | null = null;

		for (const block of blocks) {
			if (!('type' in block)) continue;

			const currentBlockType = block.type;
			const needsSpacing = this.needsSpacingBetweenBlocks(previousBlockType, currentBlockType);

			if (needsSpacing && lines.length > 0) {
				lines.push('');
			}

			const markdown = await this.convertBlock(block, context);
			if (markdown) {
				lines.push(markdown);
			}

			previousBlockType = currentBlockType;
		}

		return lines.join('\n');
	}

	private needsSpacingBetweenBlocks(prev: string | null, current: string): boolean {
		if (!prev) return false;

		const blockTypes = {
			list: ['bulleted_list_item', 'numbered_list_item', 'to_do'],
			code: ['code'],
			quote: ['quote'],
			callout: ['callout'],
			heading: ['heading_1', 'heading_2', 'heading_3'],
			table: ['table'],
		};

		const prevIsList = blockTypes.list.includes(prev);
		const currentIsList = blockTypes.list.includes(current);

		if (prevIsList && !currentIsList) return true;
		if (!prevIsList && currentIsList) return true;

		const prevIsSpecial = [...blockTypes.code, ...blockTypes.quote, ...blockTypes.callout, ...blockTypes.heading].includes(prev);
		const currentIsSpecial = [...blockTypes.code, ...blockTypes.quote, ...blockTypes.callout, ...blockTypes.heading].includes(current);

		if (prevIsSpecial || currentIsSpecial) return true;

		return false;
	}

	private async convertBlock(
		block: BlockObjectResponse,
		context: ConversionContext
	): Promise<string> {
		const indent = '  '.repeat(context.indentLevel);

		switch (block.type) {
			case 'paragraph':
				return this.convertParagraph(block, context, indent);
			case 'heading_1':
				return this.convertHeading(block, 1);
			case 'heading_2':
				return this.convertHeading(block, 2);
			case 'heading_3':
				return this.convertHeading(block, 3);
			case 'bulleted_list_item':
				return this.convertBulletedListItem(block, context, indent);
			case 'numbered_list_item':
				return this.convertNumberedListItem(block, context, indent);
			case 'to_do':
				return this.convertToDo(block, context, indent);
			case 'toggle':
				return this.convertToggle(block, context, indent);
			case 'code':
				return this.convertCode(block);
			case 'quote':
				return this.convertQuote(block, context);
			case 'callout':
				return this.convertCallout(block, context);
			case 'divider':
				return '---';
			case 'image':
				return this.convertImage(block, context);
			case 'file':
				return this.convertFile(block, context);
			case 'bookmark':
				return this.convertBookmark(block);
			case 'link_preview':
				return this.convertLinkPreview(block);
			case 'table':
				return this.convertTable(block, context);
			case 'table_row':
				return '';
			case 'child_page':
				return this.convertChildPage(block);
			case 'child_database':
				return this.convertChildDatabase(block);
			case 'equation':
				return this.convertEquation(block);
			default:
				return `${indent}<!-- Unsupported block type: ${block.type} -->`;
		}
	}

	private convertRichText(richText: RichTextItemResponse[]): string {
		return richText.map(item => this.convertRichTextItem(item)).join('');
	}

	private convertRichTextItem(item: RichTextItemResponse): string {
		let text = item.plain_text;

		if (!text) return '';

		if (item.type === 'equation' && 'equation' in item) {
			return `$${item.equation.expression}$`;
		}

		if (item.type === 'mention') {
			if ('mention' in item) {
				const mention = item.mention;
				if (mention.type === 'page' && 'page' in mention) {
					return `[[${item.plain_text}]]`;
				}
				if (mention.type === 'date' && 'date' in mention) {
					return item.plain_text;
				}
				if (mention.type === 'user' && 'user' in mention) {
					return `@${item.plain_text}`;
				}
			}
			return item.plain_text;
		}

		const annotations = item.annotations;

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

		if (item.href || (item.type === 'text' && 'text' in item && item.text.link)) {
			const url = item.href || (item.type === 'text' && 'text' in item && item.text.link ? item.text.link.url : '');
			if (url) {
				text = `[${text}](${url})`;
			}
		}

		return text;
	}

	private async convertParagraph(
		block: BlockObjectResponse,
		context: ConversionContext,
		indent: string
	): Promise<string> {
		if (block.type !== 'paragraph') return '';

		const text = this.convertRichText(block.paragraph.rich_text);

		if (!text.trim() && !block.has_children) {
			return '';
		}

		let result = text ? `${indent}${text}` : '';

		if (block.has_children) {
			const childContext = { ...context, indentLevel: context.indentLevel + 1 };
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, childContext);
			if (childMarkdown) {
				result = result ? `${result}\n${childMarkdown}` : childMarkdown;
			}
		}

		return result;
	}

	private convertHeading(block: BlockObjectResponse, level: 1 | 2 | 3): string {
		let text = '';

		if (level === 1 && block.type === 'heading_1') {
			text = this.convertRichText(block.heading_1.rich_text);
		} else if (level === 2 && block.type === 'heading_2') {
			text = this.convertRichText(block.heading_2.rich_text);
		} else if (level === 3 && block.type === 'heading_3') {
			text = this.convertRichText(block.heading_3.rich_text);
		} else {
			return '';
		}

		const prefix = '#'.repeat(level);
		return `${prefix} ${text}`;
	}

	private async convertBulletedListItem(
		block: BlockObjectResponse,
		context: ConversionContext,
		indent: string
	): Promise<string> {
		if (block.type !== 'bulleted_list_item') return '';

		const text = this.convertRichText(block.bulleted_list_item.rich_text);
		let result = `${indent}- ${text}`;

		if (block.has_children) {
			const childContext = { ...context, indentLevel: context.indentLevel + 1 };
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, childContext);
			if (childMarkdown) {
				result += `\n${childMarkdown}`;
			}
		}

		return result;
	}

	private async convertNumberedListItem(
		block: BlockObjectResponse,
		context: ConversionContext,
		indent: string
	): Promise<string> {
		if (block.type !== 'numbered_list_item') return '';

		const level = context.indentLevel;
		const counter = context.listCounters.get(level) || 0;
		context.listCounters.set(level, counter + 1);

		const text = this.convertRichText(block.numbered_list_item.rich_text);
		let result = `${indent}${counter + 1}. ${text}`;

		if (block.has_children) {
			const childContext = { ...context, indentLevel: context.indentLevel + 1 };
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, childContext);
			if (childMarkdown) {
				result += `\n${childMarkdown}`;
			}
		}

		return result;
	}

	private async convertToDo(
		block: BlockObjectResponse,
		context: ConversionContext,
		indent: string
	): Promise<string> {
		if (block.type !== 'to_do') return '';

		const checked = block.to_do.checked;
		const checkbox = checked ? '[x]' : '[ ]';
		const text = this.convertRichText(block.to_do.rich_text);
		let result = `${indent}- ${checkbox} ${text}`;

		if (block.has_children) {
			const childContext = { ...context, indentLevel: context.indentLevel + 1 };
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, childContext);
			if (childMarkdown) {
				result += `\n${childMarkdown}`;
			}
		}

		return result;
	}

	private async convertToggle(
		block: BlockObjectResponse,
		context: ConversionContext,
		indent: string
	): Promise<string> {
		if (block.type !== 'toggle') return '';

		const text = this.convertRichText(block.toggle.rich_text);
		let result = `${indent}- ${text}`;

		if (block.has_children) {
			const childContext = { ...context, indentLevel: context.indentLevel + 1 };
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, childContext);
			if (childMarkdown) {
				result += `\n${childMarkdown}`;
			}
		}

		return result;
	}

	private convertCode(block: BlockObjectResponse): string {
		if (block.type !== 'code') return '';

		const language = block.code.language || '';
		const code = this.convertRichText(block.code.rich_text);
		return `\`\`\`${language}\n${code}\n\`\`\``;
	}

	private async convertQuote(block: BlockObjectResponse, context: ConversionContext): Promise<string> {
		if (block.type !== 'quote') return '';

		const text = this.convertRichText(block.quote.rich_text);
		let result = `> ${text}`;

		if (block.has_children) {
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, context);
			if (childMarkdown) {
				const quotedChildren = childMarkdown.split('\n').map(line => `> ${line}`).join('\n');
				result += `\n${quotedChildren}`;
			}
		}

		return result;
	}

	private async convertCallout(block: BlockObjectResponse, context: ConversionContext): Promise<string> {
		if (block.type !== 'callout') return '';

		const icon = 'icon' in block.callout && block.callout.icon ?
			(block.callout.icon.type === 'emoji' ? block.callout.icon.emoji : '') : '';
		const text = this.convertRichText(block.callout.rich_text);

		let result = `> [!note]${icon ? ` ${icon}` : ''}\n> ${text}`;

		if (block.has_children) {
			const children = await this.client.getAllBlockChildren(block.id);
			const childMarkdown = await this.convertBlockList(children, context);
			if (childMarkdown) {
				const quotedChildren = childMarkdown.split('\n').map(line => `> ${line}`).join('\n');
				result += `\n${quotedChildren}`;
			}
		}

		return result;
	}

	private async convertImage(block: BlockObjectResponse, context: ConversionContext): Promise<string> {
		if (block.type !== 'image') return '';

		const image = block.image;
		let url = '';
		let caption = '';

		if (image.type === 'external') {
			url = image.external.url;
		} else if (image.type === 'file') {
			url = image.file.url;
		}

		if ('caption' in image && image.caption) {
			caption = this.convertRichText(image.caption);
		}

		if (!url) return '';

		const filename = this.extractFilenameFromUrl(url);
		const localPath = await this.downloadAttachment(url, filename, context.attachmentFolder);

		if (localPath) {
			return caption ? `![${caption}](${localPath})` : `![](${localPath})`;
		}

		return caption ? `![${caption}](${url})` : `![](${url})`;
	}

	private async convertFile(block: BlockObjectResponse, context: ConversionContext): Promise<string> {
		if (block.type !== 'file') return '';

		const file = block.file;
		let url = '';
		let caption = '';

		if (file.type === 'external') {
			url = file.external.url;
		} else if (file.type === 'file') {
			url = file.file.url;
		}

		if ('caption' in file && file.caption) {
			caption = this.convertRichText(file.caption);
		}

		if (!url) return '';

		const filename = caption || this.extractFilenameFromUrl(url);
		const localPath = await this.downloadAttachment(url, filename, context.attachmentFolder);

		if (localPath) {
			return `[${filename}](${localPath})`;
		}

		return `[${filename}](${url})`;
	}

	private convertBookmark(block: BlockObjectResponse): string {
		if (block.type !== 'bookmark') return '';

		const url = block.bookmark.url;
		const caption = block.bookmark.caption && block.bookmark.caption.length > 0
			? this.convertRichText(block.bookmark.caption)
			: url;

		return `[${caption}](${url})`;
	}

	private convertLinkPreview(block: BlockObjectResponse): string {
		if (block.type !== 'link_preview') return '';

		return `[Link](${block.link_preview.url})`;
	}

	private async convertTable(block: BlockObjectResponse, context: ConversionContext): Promise<string> {
		if (block.type !== 'table') return '';

		const hasColumnHeader = block.table.has_column_header;
		const hasRowHeader = block.table.has_row_header;

		const children = await this.client.getAllBlockChildren(block.id);
		const rows: string[][] = [];

		for (const child of children) {
			if ('type' in child && child.type === 'table_row') {
				const cells = child.table_row.cells.map(cell => this.convertRichText(cell));
				rows.push(cells);
			}
		}

		if (rows.length === 0) return '';

		const columnCount = Math.max(...rows.map(row => row.length));
		const lines: string[] = [];

		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			while (row.length < columnCount) {
				row.push('');
			}

			const rowMarkdown = `| ${row.join(' | ')} |`;
			lines.push(rowMarkdown);

			if (i === 0 && hasColumnHeader) {
				const separator = `| ${Array(columnCount).fill('---').join(' | ')} |`;
				lines.push(separator);
			}
		}

		return lines.join('\n');
	}

	private convertChildPage(block: BlockObjectResponse): string {
		if (block.type !== 'child_page') return '';

		const title = block.child_page.title;
		return `[[${title}]]`;
	}

	private convertChildDatabase(block: BlockObjectResponse): string {
		if (block.type !== 'child_database') return '';

		const title = block.child_database.title;
		return `[[${title}]]`;
	}

	private convertEquation(block: BlockObjectResponse): string {
		if (block.type !== 'equation') return '';

		const expression = block.equation.expression;
		return `$$\n${expression}\n$$`;
	}

	private extractFilenameFromUrl(url: string): string {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;
			const segments = pathname.split('/');
			const filename = segments[segments.length - 1];
			return decodeURIComponent(filename) || 'attachment';
		} catch {
			return 'attachment';
		}
	}

	private async downloadAttachment(
		url: string,
		filename: string,
		attachmentFolder: string
	): Promise<string | null> {
		try {
			const response = await fetch(url);
			if (!response.ok) return null;

			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);

			const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
			const fullPath = `${attachmentFolder}/${sanitizedFilename}`;

			await this.vault.createBinary(fullPath, buffer);

			return sanitizedFilename;
		} catch (error) {
			console.error(`Failed to download attachment: ${url}`, error);
			return null;
		}
	}
}
