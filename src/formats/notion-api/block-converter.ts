/**
 * Block conversion functions for Notion API importer
 * Converts Notion blocks to Markdown format
 */

import { BlockObjectResponse } from '@notionhq/client';
import { ImportContext } from '../../main';

/**
 * Convert Notion blocks to Markdown
 */
export async function convertBlocksToMarkdown(
	blocks: BlockObjectResponse[], 
	ctx: ImportContext,
	currentFolderPath: string
): Promise<string> {
	const lines: string[] = [];
	
	for (const block of blocks) {
		if (ctx.isCancelled()) break;
		
		const markdown = await convertBlockToMarkdown(block, ctx, currentFolderPath);
		if (markdown) {
			lines.push(markdown);
		}
	}
	
	return lines.join('\n\n');
}

/**
 * Convert a single Notion block to Markdown
 * This is the main routing function that delegates to specific converters
 */
export async function convertBlockToMarkdown(
	block: BlockObjectResponse,
	ctx: ImportContext,
	currentFolderPath: string
): Promise<string> {
	const type = block.type;
	
	switch (type) {
		case 'paragraph':
			return convertParagraph(block);
		
		case 'heading_1':
		case 'heading_2':
		case 'heading_3':
			return convertHeading(block);
		
		case 'bulleted_list_item':
			return convertBulletedListItem(block);
		
		case 'numbered_list_item':
			return convertNumberedListItem(block);
		
		case 'quote':
			return convertQuote(block);
		
		default:
			// Unsupported block type - skip for now
			return '';
	}
}

/**
 * Convert paragraph block to Markdown
 */
export function convertParagraph(block: BlockObjectResponse): string {
	if (block.type !== 'paragraph') return '';
	return convertRichText(block.paragraph.rich_text);
}

/**
 * Convert heading block to Markdown
 */
export function convertHeading(block: BlockObjectResponse): string {
	if (block.type === 'heading_1') {
		return '# ' + convertRichText(block.heading_1.rich_text);
	}
	else if (block.type === 'heading_2') {
		return '## ' + convertRichText(block.heading_2.rich_text);
	}
	else if (block.type === 'heading_3') {
		return '### ' + convertRichText(block.heading_3.rich_text);
	}
	return '';
}

/**
 * Convert bulleted list item to Markdown
 */
export function convertBulletedListItem(block: BlockObjectResponse): string {
	if (block.type !== 'bulleted_list_item') return '';
	return '- ' + convertRichText(block.bulleted_list_item.rich_text);
}

/**
 * Convert numbered list item to Markdown
 */
export function convertNumberedListItem(block: BlockObjectResponse): string {
	if (block.type !== 'numbered_list_item') return '';
	return '1. ' + convertRichText(block.numbered_list_item.rich_text);
}

/**
 * Convert quote block to Markdown
 */
export function convertQuote(block: BlockObjectResponse): string {
	if (block.type !== 'quote') return '';
	return '> ' + convertRichText(block.quote.rich_text);
}

/**
 * Convert Notion rich text to plain Markdown text with formatting
 */
export function convertRichText(richTextArray: any[]): string {
	if (!richTextArray || richTextArray.length === 0) return '';
	
	return richTextArray.map(rt => {
		let text = rt.plain_text || '';
		
		// Apply formatting
		if (rt.annotations) {
			if (rt.annotations.bold) {
				text = `**${text}**`;
			}
			if (rt.annotations.italic) {
				text = `*${text}*`;
			}
			if (rt.annotations.code) {
				text = `\`${text}\``;
			}
			if (rt.annotations.strikethrough) {
				text = `~~${text}~~`;
			}
		}
		
		// Handle links
		if (rt.href) {
			text = `[${text}](${rt.href})`;
		}
		
		return text;
	}).join('');
}

