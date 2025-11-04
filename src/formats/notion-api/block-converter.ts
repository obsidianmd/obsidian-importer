/**
 * Block conversion functions for Notion API importer
 * Converts Notion blocks to Markdown format
 */

import { BlockObjectResponse, Client } from '@notionhq/client';
import { Vault } from 'obsidian';
import { ImportContext } from '../../main';
import { fetchAllBlocks } from './api-helpers';
import { downloadAttachment, extractAttachmentFromBlock, getCaptionFromBlock, formatAttachmentLink } from './attachment-helpers';

/**
 * Callback type for importing child pages
 */
export type ImportPageCallback = (pageId: string, parentPath: string) => Promise<void>;

/**
 * Context for block conversion operations
 */
export interface BlockConversionContext {
	ctx: ImportContext;
	currentFolderPath: string;
	client: Client;
	vault: Vault;
	downloadExternalAttachments: boolean;
	indentLevel?: number;
	blocksCache?: Map<string, BlockObjectResponse[]>;
	importPageCallback?: ImportPageCallback;
}

/**
 * Convert Notion blocks to Markdown
 */
export async function convertBlocksToMarkdown(
	blocks: BlockObjectResponse[],
	context: BlockConversionContext
): Promise<string> {
	const lines: string[] = [];
	
	for (let i = 0; i < blocks.length; i++) {
		if (context.ctx.isCancelled()) break;
		
		const block = blocks[i];
		const markdown = await convertBlockToMarkdown(block, context);
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
	context: BlockConversionContext
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
			markdown = await convertBulletedListItem(block, context);
			break;
		
		case 'numbered_list_item':
			markdown = await convertNumberedListItem(block, context);
			break;
		
		case 'quote':
			markdown = convertQuote(block);
			break;
		
		case 'image':
			markdown = await convertImage(block, context);
			break;
		
		case 'video':
			markdown = await convertVideo(block, context);
			break;
		
		case 'file':
			markdown = await convertFile(block, context);
			break;
		
		case 'pdf':
			markdown = await convertPdf(block, context);
			break;
		
		case 'bookmark':
			markdown = convertBookmark(block);
			break;
		
		case 'embed':
			markdown = convertEmbed(block);
			break;
		
		case 'link_preview':
			markdown = convertLinkPreview(block);
			break;
		
		case 'child_database':
			// Database blocks are handled separately in the main importer
			// Return a placeholder that will be replaced
			markdown = `<!-- DATABASE_PLACEHOLDER:${block.id} -->`;
			break;
		
		case 'child_page':
			// Child page blocks: import the page and return a link
			if (context.importPageCallback) {
				try {
					// Import the child page under current folder
					await context.importPageCallback(block.id, context.currentFolderPath);
					
					// Get page title from block
					const pageTitle = (block as any).child_page?.title || 'Untitled';
					
					// Return a wiki link to the child page
					markdown = `[[${pageTitle}]]`;
				}
				catch (error) {
					console.error(`Failed to import child page ${block.id}:`, error);
					markdown = `<!-- Failed to import child page: ${error.message} -->`;
				}
			}
			else {
				// No callback provided, just skip
				console.warn(`child_page block ${block.id} skipped: no import callback provided`);
				markdown = '';
			}
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
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'bulleted_list_item') return '';
	
	const indentLevel = context.indentLevel || 0;
	const indent = '  '.repeat(indentLevel); // 2 spaces per indent level
	let markdown = indent + '- ' + convertRichText(block.bulleted_list_item.rich_text);
	
	// Check if this block has children
	if (block.has_children) {
		try {
			// Try to get from cache first
			let children = context.blocksCache?.get(block.id);
			
			if (!children) {
				// Not in cache, fetch from API
				children = await fetchAllBlocks(context.client, block.id, context.ctx);
				
				// Store in cache if cache is provided
				if (context.blocksCache) {
					context.blocksCache.set(block.id, children);
				}
			}
			
			if (children.length > 0) {
				const childrenMarkdown = await convertBlocksToMarkdown(
					children,
					{
						...context,
						indentLevel: indentLevel + 1
					}
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
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'numbered_list_item') return '';
	
	const indentLevel = context.indentLevel || 0;
	// Use 2 spaces per indent level (standard Markdown)
	const indent = '  '.repeat(indentLevel);
	let markdown = indent + '1. ' + convertRichText(block.numbered_list_item.rich_text);
	
	// Check if this block has children
	if (block.has_children) {
		try {
			// Try to get from cache first
			let children = context.blocksCache?.get(block.id);
			
			if (!children) {
				// Not in cache, fetch from API
				children = await fetchAllBlocks(context.client, block.id, context.ctx);
				
				// Store in cache if cache is provided
				if (context.blocksCache) {
					context.blocksCache.set(block.id, children);
				}
			}
			
			if (children.length > 0) {
				const childrenMarkdown = await convertBlocksToMarkdown(
					children,
					{
						...context,
						indentLevel: indentLevel + 1
					}
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
 * Convert image block to Markdown
 */
export async function convertImage(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'image') return '';
	
	const attachment = extractAttachmentFromBlock(block);
	if (!attachment) return '';
	
	const caption = getCaptionFromBlock(block);
	
	try {
		const result = await downloadAttachment(
			attachment,
			context.vault,
			context.ctx,
			context.downloadExternalAttachments
		);
		
		// Format link according to user's vault settings
		return formatAttachmentLink(result, context.vault, caption, true);
	}
	catch (error) {
		console.error(`Failed to convert image block:`, error);
		// If download failed, return a simple markdown image link with the original URL
		return `![${caption || 'Image'}](${attachment.url})`;
	}
}

/**
 * Check if URL is a YouTube video
 */
function isYouTubeUrl(url: string): boolean {
	return url.includes('youtube.com') || url.includes('youtu.be');
}

/**
 * Convert video block to Markdown
 */
export async function convertVideo(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'video') return '';
	
	const attachment = extractAttachmentFromBlock(block);
	if (!attachment) return '';
	
	const caption = getCaptionFromBlock(block);
	const url = attachment.url;
	
	// For external YouTube videos, use embed syntax directly without downloading
	if (attachment.type === 'external' && isYouTubeUrl(url)) {
		return `![${caption || ''}](${url})`;
	}
	
	try {
		const result = await downloadAttachment(
			attachment,
			context.vault,
			context.ctx,
			context.downloadExternalAttachments
		);
		
		// Format link according to user's vault settings
		return formatAttachmentLink(result, context.vault, caption || 'Video', true);
	}
	catch (error) {
		console.error(`Failed to convert video block:`, error);
		// If download failed, return a simple markdown link with the original URL
		return `![${caption || 'Video'}](${url})`;
	}
}

/**
 * Convert file block to Markdown
 */
export async function convertFile(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'file') return '';
	
	const attachment = extractAttachmentFromBlock(block);
	if (!attachment) return '';
	
	const caption = getCaptionFromBlock(block);
	
	try {
		const result = await downloadAttachment(
			attachment,
			context.vault,
			context.ctx,
			context.downloadExternalAttachments
		);
		
		// Format link according to user's vault settings (not embed for files)
		return formatAttachmentLink(result, context.vault, caption || 'File', false);
	}
	catch (error) {
		console.error(`Failed to convert file block:`, error);
		// If download failed, return a simple markdown link with the original URL
		return `[${caption || 'File'}](${attachment.url})`;
	}
}

/**
 * Convert PDF block to Markdown
 */
export async function convertPdf(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'pdf') return '';
	
	const attachment = extractAttachmentFromBlock(block);
	if (!attachment) return '';
	
	const caption = getCaptionFromBlock(block);
	
	try {
		const result = await downloadAttachment(
			attachment,
			context.vault,
			context.ctx,
			context.downloadExternalAttachments
		);
		
		// Format link according to user's vault settings (embed for PDFs)
		return formatAttachmentLink(result, context.vault, caption || 'PDF', true);
	}
	catch (error) {
		console.error(`Failed to convert PDF block:`, error);
		// If download failed, return a simple markdown link with the original URL
		return `[${caption || 'PDF'}](${attachment.url})`;
	}
}

/**
 * Check if URL is embeddable in Obsidian
 * Obsidian supports embedding YouTube and Twitter/X content
 * @see https://help.obsidian.md/embed-web-pages
 */
function isEmbeddableUrl(url: string): boolean {
	return url.includes('youtube.com') || 
	       url.includes('youtu.be') || 
	       url.includes('twitter.com') || 
	       url.includes('x.com');
}

/**
 * Convert bookmark block to Markdown
 * Bookmarks are always links in Notion (not embedded), so convert to simple markdown links
 */
export function convertBookmark(block: BlockObjectResponse): string {
	if (block.type !== 'bookmark') return '';
	
	const bookmarkData = (block as any).bookmark;
	if (!bookmarkData) return '';
	
	const url = bookmarkData.url || '';
	const caption = getCaptionFromBlock(block);
	
	// Bookmarks are link cards in Notion, not embedded content
	// So always return a simple markdown link, even for YouTube/Twitter
	if (caption) {
		return `[${caption}](${url})`;
	}
	return `[${url}](${url})`;
}

/**
 * Convert embed block to Markdown
 * Embeds use embed syntax for YouTube/Twitter, otherwise simple links
 */
export function convertEmbed(block: BlockObjectResponse): string {
	if (block.type !== 'embed') return '';
	
	const embedData = (block as any).embed;
	if (!embedData) return '';
	
	const url = embedData.url || '';
	const caption = getCaptionFromBlock(block);
	
	// Use embed syntax for YouTube and Twitter/X
	if (isEmbeddableUrl(url)) {
		return `![${caption || ''}](${url})`;
	}
	
	// Return a simple markdown link for other URLs
	if (caption) {
		return `[${caption}](${url})`;
	}
	return `[${url}](${url})`;
}

/**
 * Convert link_preview block to Markdown
 * Link previews are always links in Notion (not embedded), so convert to simple markdown links
 */
export function convertLinkPreview(block: BlockObjectResponse): string {
	if (block.type !== 'link_preview') return '';
	
	const linkPreviewData = (block as any).link_preview;
	if (!linkPreviewData) return '';
	
	const url = linkPreviewData.url || '';
	
	// Link previews are preview cards in Notion, not embedded content
	// So always return a simple markdown link, even for YouTube/Twitter
	return `[${url}](${url})`;
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

