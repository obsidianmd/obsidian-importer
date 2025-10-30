/**
 * Block conversion functions for Notion API importer
 * Converts Notion blocks to Markdown format
 */

import { BlockObjectResponse, Client } from '@notionhq/client';
import { ImportContext } from '../../main';
import { fetchAllBlocks } from './api-helpers';

/**
 * Convert Notion blocks to Markdown
 */
export async function convertBlocksToMarkdown(
	blocks: BlockObjectResponse[], 
	ctx: ImportContext,
	currentFolderPath: string,
	client: Client,
	indentLevel: number = 0
): Promise<string> {
	const lines: string[] = [];
	
	for (let i = 0; i < blocks.length; i++) {
		if (ctx.isCancelled()) break;
		
		const block = blocks[i];
		const markdown = await convertBlockToMarkdown(block, ctx, currentFolderPath, client, indentLevel);
		if (markdown) {
			lines.push(markdown);
			
			// Add empty string for extra spacing when transitioning between list and non-list blocks
			if (i < blocks.length - 1) {
				const currentIsList = block.type === 'bulleted_list_item' || block.type === 'numbered_list_item';
				const nextBlock = blocks[i + 1];
				const nextIsList = nextBlock.type === 'bulleted_list_item' || nextBlock.type === 'numbered_list_item';
				
				// Add empty string (extra newline) when not both list items
				if (!currentIsList || !nextIsList) {
					lines.push('');
				}
			}
		}
	}
	
	return lines.join('\n');
}

/**
 * Convert a single Notion block to Markdown
 * This is the main routing function that delegates to specific converters
 */
export async function convertBlockToMarkdown(
	block: BlockObjectResponse,
	ctx: ImportContext,
	currentFolderPath: string,
	client: Client,
	indentLevel: number = 0
): Promise<string> {
	const type = block.type;
	let markdown = '';
	
	switch (type) {
		case 'paragraph':
			markdown = convertParagraph(block);
			break;
		
		case 'heading_1':
		case 'heading_2':
		case 'heading_3':
			markdown = convertHeading(block);
			break;
		
		case 'bulleted_list_item':
			markdown = await convertBulletedListItem(block, ctx, currentFolderPath, client, indentLevel);
			break;
		
		case 'numbered_list_item':
			markdown = await convertNumberedListItem(block, ctx, currentFolderPath, client, indentLevel);
			break;
		
		case 'quote':
			markdown = convertQuote(block);
			break;
		
		case 'child_database':
			// Database blocks are handled separately in the main importer
			// Return a placeholder that will be replaced
			markdown = `<!-- DATABASE_PLACEHOLDER:${block.id} -->`;
			break;
		
		default:
			// Unsupported block type - skip for now
			console.log(`Unsupported block type: ${type}`);
			markdown = '';
	}
	
	return markdown;
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
 * Convert bulleted list item to Markdown with nested children support
 */
export async function convertBulletedListItem(
	block: BlockObjectResponse,
	ctx: ImportContext,
	currentFolderPath: string,
	client: Client,
	indentLevel: number = 0
): Promise<string> {
	if (block.type !== 'bulleted_list_item') return '';
	
	const indent = '  '.repeat(indentLevel); // 2 spaces per indent level
	let markdown = indent + '- ' + convertRichText(block.bulleted_list_item.rich_text);
	
	// Check if this block has children
	if (block.has_children) {
		try {
			const children = await fetchAllBlocks(client, block.id, ctx);
			if (children.length > 0) {
				const childrenMarkdown = await convertBlocksToMarkdown(
					children, 
					ctx, 
					currentFolderPath, 
					client, 
					indentLevel + 1
				);
				if (childrenMarkdown) {
					markdown += '\n' + childrenMarkdown;
				}
			}
		}
		catch (error) {
			console.error(`Failed to fetch children for block ${block.id}:`, error);
		}
	}
	
	return markdown;
}

/**
 * Convert numbered list item to Markdown with nested children support
 */
export async function convertNumberedListItem(
	block: BlockObjectResponse,
	ctx: ImportContext,
	currentFolderPath: string,
	client: Client,
	indentLevel: number = 0
): Promise<string> {
	if (block.type !== 'numbered_list_item') return '';
	
	// Use 2 spaces per indent level (standard Markdown)
	const indent = '  '.repeat(indentLevel);
	let markdown = indent + '1. ' + convertRichText(block.numbered_list_item.rich_text);
	
	// Check if this block has children
	if (block.has_children) {
		try {
			const children = await fetchAllBlocks(client, block.id, ctx);
			if (children.length > 0) {
				const childrenMarkdown = await convertBlocksToMarkdown(
					children, 
					ctx, 
					currentFolderPath, 
					client, 
					indentLevel + 1
				);
				if (childrenMarkdown) {
					markdown += '\n' + childrenMarkdown;
				}
			}
		}
		catch (error) {
			console.error(`Failed to fetch children for block ${block.id}:`, error);
		}
	}
	
	return markdown;
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

