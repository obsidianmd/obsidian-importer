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
	mentionedIds?: Set<string>; // Collect mentioned page/database IDs during conversion
	syncedBlocksMap?: Map<string, string>; // Map synced block ID to file path
	outputRootPath?: string; // Root path for output (needed for synced blocks folder)
	syncedChildPlaceholders?: Map<string, Set<string>>; // Map file path to synced child IDs
}

/**
 * Determine if spacing (empty line) should be added between two blocks
 * Based on STRICT Markdown syntax requirements ONLY
 * 
 * Philosophy: Render blocks as-is without adding extra spacing,
 * EXCEPT where Markdown syntax absolutely requires it for correct rendering.
 * 
 * Rules:
 * 1. List ↔ Non-list transition: MUST have spacing (Markdown requirement)
 * 2. Everything else: NO spacing (render as-is)
 */
function shouldAddSpacingBetweenBlocks(currentType: string, nextType: string): boolean {
	// Define list types (including to_do)
	const listTypes = ['bulleted_list_item', 'numbered_list_item', 'to_do'];
	
	const currentIsList = listTypes.includes(currentType);
	const nextIsList = listTypes.includes(nextType);
	
	// ONLY rule: List ↔ Non-list transition requires spacing
	// This is a Markdown syntax requirement to properly separate lists from other content
	if (currentIsList !== nextIsList) {
		return true;
	}
	
	// Default: NO spacing (render blocks directly one after another)
	return false;
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
			
			// Add spacing between blocks based on Markdown syntax requirements
			// Only add empty lines where necessary for proper Markdown rendering
			if (i < blocks.length - 1) {
				const nextBlock = blocks[i + 1];
				
				if (shouldAddSpacingBetweenBlocks(block.type, nextBlock.type)) {
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
			markdown = convertParagraph(block, context);
			break;
		
		case 'heading_1':
		case 'heading_2':
		case 'heading_3':
			markdown = convertHeading(block, context);
			break;
		
		case 'bulleted_list_item':
			markdown = await convertBulletedListItem(block, context);
			break;
		
		case 'to_do':
			markdown = await convertToDo(block, context);
			break;
		
		case 'column_list':
			markdown = await convertColumnList(block, context);
			break;
		
		case 'toggle':
			markdown = await convertToggle(block, context);
			break;
		
		case 'synced_block':
			markdown = await convertSyncedBlock(block, context);
			break;
		
		case 'numbered_list_item':
			markdown = await convertNumberedListItem(block, context);
			break;
		
		case 'quote':
			markdown = convertQuote(block, context);
			break;
		
		case 'callout':
			markdown = await convertCallout(block, context);
			break;
		
		case 'divider':
			markdown = convertDivider(block);
			break;
		
		case 'equation':
			markdown = convertEquation(block);
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
		// Special handling for databases inside synced blocks
		const isInSyncedBlockDb = context.currentFolderPath?.includes('Notion Synced Blocks');
		
		if (isInSyncedBlockDb) {
			// Inside synced block: use placeholder for later replacement
			const databaseId = block.id;
			
			// Return placeholder that will be replaced later
			// Format: [[SYNCED_CHILD_DATABASE:id]]
			markdown = `[[SYNCED_CHILD_DATABASE:${databaseId}]]`;
		}
		else {
			// Normal page: return placeholder for database processing
			markdown = `<!-- DATABASE_PLACEHOLDER:${block.id} -->`;
		}
		break;
		
	case 'child_page':
		// Child page blocks: import the page and return a link
		// Special handling for pages inside synced blocks
		const isInSyncedBlock = context.currentFolderPath?.includes('Notion Synced Blocks');
		
		if (isInSyncedBlock) {
			// Inside synced block: check if already imported, otherwise use placeholder
			const pageId = block.id;
			
			// Check if page is already imported (using notionIdToPath from context)
			// Note: notionIdToPath is not in BlockConversionContext, we need to add it
			// For now, always use placeholder and handle in replacement phase
			
			// Return placeholder that will be replaced later
			// Format: [[SYNCED_CHILD_PAGE:id]]
			markdown = `[[SYNCED_CHILD_PAGE:${pageId}]]`;
		}
		else if (context.importPageCallback) {
			// Normal page: import the child page
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
export function convertParagraph(block: BlockObjectResponse, context?: BlockConversionContext): string {
	if (block.type !== 'paragraph') return '';
	return convertRichText(block.paragraph.rich_text, context);
}

/**
 * Convert heading block to Markdown
 */
export function convertHeading(block: BlockObjectResponse, context?: BlockConversionContext): string {
	if (block.type === 'heading_1') {
		return '# ' + convertRichText(block.heading_1.rich_text, context);
	}
	else if (block.type === 'heading_2') {
		return '## ' + convertRichText(block.heading_2.rich_text, context);
	}
	else if (block.type === 'heading_3') {
		return '### ' + convertRichText(block.heading_3.rich_text, context);
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
	let markdown = indent + '- ' + convertRichText(block.bulleted_list_item.rich_text, context);
	
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
 * Convert a Notion to_do block to Markdown task list format
 * Supports nested children including child pages
 */
export async function convertToDo(
	block: BlockObjectResponse,
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'to_do') return '';
	
	const indentLevel = context.indentLevel || 0;
	const indent = '  '.repeat(indentLevel); // 2 spaces per indent level
	
	// Use [x] for checked items, [ ] for unchecked
	const checkbox = block.to_do.checked ? '[x]' : '[ ]';
	let markdown = indent + '- ' + checkbox + ' ' + convertRichText(block.to_do.rich_text, context);
	
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
 * Convert a Notion column_list block to Markdown
 * Flattens columns from left to right, rendering content top to bottom
 * Each column is marked with a comment for clarity
 */
export async function convertColumnList(
	block: BlockObjectResponse,
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'column_list') return '';
	
	// Column list must have children (the columns)
	if (!block.has_children) return '';
	
	try {
		// Try to get from cache first
		let columns = context.blocksCache?.get(block.id);
		
		if (!columns) {
			// Not in cache, fetch from API
			columns = await fetchAllBlocks(context.client, block.id, context.ctx);
			
			// Store in cache if cache is provided
			if (context.blocksCache) {
				context.blocksCache.set(block.id, columns);
			}
		}
		
		if (columns.length === 0) return '';
		
		let markdown = '';
		
		// Process each column from left to right
		for (let i = 0; i < columns.length; i++) {
			const column = columns[i];
			
			if (column.type !== 'column') {
				console.warn(`Expected column block, got ${column.type}`);
				continue;
			}
			
			// Add column marker comment
			markdown += `<!-- Column ${i + 1} -->\n`;
			
			// Convert the column's content
			const columnMarkdown = await convertColumn(column, context);
			if (columnMarkdown) {
				markdown += columnMarkdown;
			}
			
			// Add spacing between columns (but not after the last one)
			if (i < columns.length - 1) {
				markdown += '\n\n';
			}
		}
		
		return markdown;
	}
	catch (error) {
		console.error(`Failed to convert column_list ${block.id}:`, error);
		return '';
	}
}

/**
 * Convert a Notion column block to Markdown
 * Renders the column's content from top to bottom
 */
export async function convertColumn(
	block: BlockObjectResponse,
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'column') return '';
	
	// Column must have children (the content blocks)
	if (!block.has_children) return '';
	
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
		
		if (children.length === 0) return '';
		
		// Convert all blocks in this column
		const markdown = await convertBlocksToMarkdown(children, context);
		
		return markdown;
	}
	catch (error) {
		console.error(`Failed to convert column ${block.id}:`, error);
		return '';
	}
}

/**
 * Extract the first line of text from a block recursively
 * Used for naming synced block files
 */
async function extractFirstLineText(
	block: BlockObjectResponse,
	client: Client,
	ctx: ImportContext,
	maxLength: number = 20
): Promise<string> {
	// Try to get text from the block itself
	let text = '';
	
	// Extract text based on block type
	if ('rich_text' in (block as any)[block.type]) {
		const richText = (block as any)[block.type].rich_text;
		if (richText && richText.length > 0) {
			text = richText.map((rt: any) => rt.plain_text || '').join('');
		}
	}
	
	// If we found text, return it (truncated)
	if (text.trim()) {
		return text.trim().substring(0, maxLength);
	}
	
	// If no text found and block has children, recursively check first child
	if (block.has_children) {
		try {
			const children = await fetchAllBlocks(client, block.id, ctx);
			if (children.length > 0) {
				return await extractFirstLineText(children[0], client, ctx, maxLength);
			}
		}
		catch (error) {
			console.error(`Failed to fetch children for first line text extraction:`, error);
		}
	}
	
	// Fallback to block type
	return `Synced Block`;
}

/**
 * Create a synced block file and return the file path
 * This is used for both original blocks and synced copies
 */
async function createSyncedBlockFile(
	blockId: string,
	context: BlockConversionContext
): Promise<string> {
	const { client, ctx, vault, outputRootPath } = context;
	
	if (!outputRootPath) {
		throw new Error('outputRootPath is required for synced blocks');
	}
	
	try {
		// Fetch the block to get its content
		const block = await client.blocks.retrieve({ block_id: blockId }) as BlockObjectResponse;
		
		// Get the block's children (the actual content)
		let children: BlockObjectResponse[] = [];
		if (block.has_children) {
			children = await fetchAllBlocks(client, blockId, ctx);
		}
		
		// Extract first line text for filename
		let fileName = 'Synced Block';
		if (children.length > 0) {
			fileName = await extractFirstLineText(children[0], client, ctx, 20);
		}
		
		// Sanitize filename
		fileName = fileName.replace(/[\/\?<>\\:\*\|"]/g, '').trim() || 'Synced Block';
		
	// Create "Notion Synced Blocks" folder
	const parentPath = outputRootPath.split('/').slice(0, -1).join('/') || '/';
	const syncedBlocksFolder = parentPath === '/' ? '/Notion Synced Blocks' : parentPath + '/Notion Synced Blocks';
	
	// Check if folder exists before creating
	const existingFolder = vault.getAbstractFileByPath(syncedBlocksFolder);
	if (!existingFolder) {
		try {
			await vault.createFolder(syncedBlocksFolder);
		}
		catch (error) {
			// Ignore error if folder was created by another concurrent operation
			if (!error.message?.includes('already exists')) {
				console.error('Failed to create Notion Synced Blocks folder:', error);
			}
		}
	}
		
	// Generate unique file path
	let filePath = `${syncedBlocksFolder}/${fileName}.md`;
	let counter = 1;
	while (vault.getAbstractFileByPath(filePath)) {
		filePath = `${syncedBlocksFolder}/${fileName} (${counter}).md`;
		counter++;
	}
	
	// Create a new context for synced block content
	// Set currentFolderPath to the synced blocks folder
	const syncedBlockContext: BlockConversionContext = {
		...context,
		currentFolderPath: syncedBlocksFolder
	};
	
	// Convert children to markdown
	const markdown = await convertBlocksToMarkdown(children, syncedBlockContext);
	
	// Extract synced child IDs from the markdown content
	// This allows us to efficiently replace placeholders later without scanning all files
	const syncedChildIds = new Set<string>();
	
	// Find SYNCED_CHILD_PAGE placeholders
	const pageMatches = markdown.matchAll(/\[\[SYNCED_CHILD_PAGE:([a-f0-9-]+)\]\]/g);
	for (const match of pageMatches) {
		syncedChildIds.add(match[1]);
	}
	
	// Find SYNCED_CHILD_DATABASE placeholders
	const dbMatches = markdown.matchAll(/\[\[SYNCED_CHILD_DATABASE:([a-f0-9-]+)\]\]/g);
	for (const match of dbMatches) {
		syncedChildIds.add(match[1]);
	}
	
	// Record synced child placeholders for this file
	if (context.syncedChildPlaceholders && syncedChildIds.size > 0) {
		context.syncedChildPlaceholders.set(filePath, syncedChildIds);
	}
	
	// Create the file
	await vault.create(filePath, markdown);
		
		console.log(`Created synced block file: ${filePath}`);
		
		return filePath;
	}
	catch (error) {
		console.error(`Failed to create synced block file for ${blockId}:`, error);
		throw error;
	}
}

/**
 * Convert a Notion synced_block to Obsidian wiki link
 * Handles both original blocks and synced copies
 */
export async function convertSyncedBlock(
	block: BlockObjectResponse,
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'synced_block') return '';
	
	const syncedBlockData = (block as any).synced_block;
	if (!syncedBlockData) return '';
	
	const { syncedBlocksMap } = context;
	if (!syncedBlocksMap) {
		console.error('syncedBlocksMap is required for synced blocks');
		return '';
	}
	
	// Determine if this is an original block or a synced copy
	const isOriginal = syncedBlockData.synced_from === null;
	const originalBlockId = isOriginal ? block.id : syncedBlockData.synced_from.block_id;
	
	// Check if we already have a file for this synced block
	let filePath = syncedBlocksMap.get(originalBlockId);
	
	if (!filePath) {
		// File doesn't exist yet, create it
		try {
			filePath = await createSyncedBlockFile(originalBlockId, context);
			// Record the mapping
			syncedBlocksMap.set(originalBlockId, filePath);
		}
		catch (error) {
			console.error(`Failed to process synced block ${originalBlockId}:`, error);
			return `<!-- Failed to import synced block: ${error.message} -->`;
		}
	}
	
	// Extract filename without extension for wiki link
	const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || 'Synced Block';
	
	// Return wiki link to the synced block file
	return `![[${fileName}]]`;
}

/**
 * Convert a Notion toggle block to Obsidian foldable callout
 * Uses + for expanded state (foldable) and - for collapsed state (expandable)
 */
export async function convertToggle(
	block: BlockObjectResponse,
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'toggle') return '';
	
	const toggleData = (block as any).toggle;
	if (!toggleData) return '';
	
	// Get toggle text
	const text = convertRichText(toggleData.rich_text, context);
	
	// In Notion API, we can't directly get the toggle state (expanded/collapsed)
	// So we default to expanded (+) which is more user-friendly
	// Users can manually change it to (-) if they want it collapsed by default
	const foldState = '+'; // Default to expanded (foldable)
	
	// Create Obsidian foldable callout
	// Using 'note' type as default for toggles
	let markdown = `> [!note]${foldState} ${text}\n`;
	
	// Handle children if any
	if (block.has_children) {
		try {
			let children = context.blocksCache?.get(block.id);
			if (!children) {
				children = await fetchAllBlocks(context.client, block.id, context.ctx);
				if (context.blocksCache) {
					context.blocksCache.set(block.id, children);
				}
			}
			
			if (children.length > 0) {
				const childrenMarkdown = await convertBlocksToMarkdown(
					children,
					context
				);
				if (childrenMarkdown) {
					// Indent children content with '> ' for callout
					const indentedChildren = childrenMarkdown.split('\n').map(line => `> ${line}`).join('\n');
					markdown += indentedChildren;
				}
			}
		}
		catch (error) {
			console.error(`Failed to fetch children for toggle block ${block.id}:`, error);
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
	let markdown = indent + '1. ' + convertRichText(block.numbered_list_item.rich_text, context);
	
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
export function convertQuote(block: BlockObjectResponse, context?: BlockConversionContext): string {
	if (block.type !== 'quote') return '';
	return '> ' + convertRichText(block.quote.rich_text, context);
}

/**
 * Convert callout block to Markdown (Obsidian callout syntax)
 */
export async function convertCallout(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'callout') return '';
	
	const calloutData = (block as any).callout;
	if (!calloutData) return '';
	
	// Get callout icon and text
	const icon = calloutData.icon?.emoji || '📌';
	const text = convertRichText(calloutData.rich_text, context);
	
	// Map Notion callout types to Obsidian callout types
	// Notion doesn't have explicit callout types, so we use a default type
	let calloutType = 'note';
	
	// Try to infer callout type from icon
	if (icon === '💡' || icon === '⚡') calloutType = 'tip';
	else if (icon === '⚠️' || icon === '❗') calloutType = 'warning';
	else if (icon === '❌' || icon === '🚫') calloutType = 'danger';
	else if (icon === '✅' || icon === '✔️') calloutType = 'success';
	else if (icon === 'ℹ️' || icon === 'ℹ') calloutType = 'info';
	else if (icon === '❓' || icon === '🤔') calloutType = 'question';
	
	// Create Obsidian callout
	let markdown = `> [!${calloutType}] ${icon}\n`;
	markdown += `> ${text}`;
	
	// Handle children if any
	if (block.has_children) {
		try {
			let children = context.blocksCache?.get(block.id);
			if (!children) {
				children = await fetchAllBlocks(context.client, block.id, context.ctx);
				if (context.blocksCache) {
					context.blocksCache.set(block.id, children);
				}
			}
			
			if (children.length > 0) {
				const childrenMarkdown = await convertBlocksToMarkdown(
					children,
					{ ...context, indentLevel: (context.indentLevel || 0) + 1 }
				);
				if (childrenMarkdown) {
					// Indent children content with '> ' for callout
					const indentedChildren = childrenMarkdown.split('\n').map(line => `> ${line}`).join('\n');
					markdown += '\n' + indentedChildren;
				}
			}
		}
		catch (error) {
			console.error(`Failed to fetch children for callout block ${block.id}:`, error);
		}
	}
	
	return markdown;
}

/**
 * Convert divider block to Markdown
 */
export function convertDivider(block: BlockObjectResponse): string {
	if (block.type !== 'divider') return '';
	// Standard Markdown horizontal rule
	return '---';
}

/**
 * Convert equation block to Markdown (block-level math)
 */
export function convertEquation(block: BlockObjectResponse): string {
	if (block.type !== 'equation') return '';
	
	const equationData = (block as any).equation;
	if (!equationData || !equationData.expression) return '';
	
	// Obsidian uses $$ for block-level math
	return `$$\n${equationData.expression}\n$$`;
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
 * Handles inline elements: text, mentions, equations, links, and annotations
 */
export function convertRichText(richTextArray: any[], context?: BlockConversionContext): string {
	if (!richTextArray || richTextArray.length === 0) return '';
	
	return richTextArray.map(rt => {
		const type = rt.type;
		let text = '';
		
		// Handle different rich text types
		switch (type) {
			case 'text':
				text = rt.plain_text || '';
				break;
			
			case 'mention':
				text = convertMention(rt, context);
				break;
			
			case 'equation':
				// Inline equation using single $
				text = `$${rt.equation?.expression || ''}$`;
				break;
			
			default:
				text = rt.plain_text || '';
		}
		
		// Apply annotations (inline styles)
		if (rt.annotations && type !== 'equation') {
			// Bold
			if (rt.annotations.bold) {
				text = `**${text}**`;
			}
			// Italic
			if (rt.annotations.italic) {
				text = `*${text}*`;
			}
			// Code
			if (rt.annotations.code) {
				text = `\`${text}\``;
			}
			// Strikethrough
			if (rt.annotations.strikethrough) {
				text = `~~${text}~~`;
			}
			// Underline - Obsidian doesn't support underline in standard markdown, use <u> tag
			if (rt.annotations.underline) {
				text = `<u>${text}</u>`;
			}
			// Highlight - use Obsidian highlight syntax
			if (rt.annotations.color && rt.annotations.color.includes('background')) {
				text = `==${text}==`;
			}
		}
		
		// Handle links (external href)
		if (rt.href && type !== 'mention') {
			text = `[${text}](${rt.href})`;
		}
		
		return text;
	}).join('');
}

/**
 * Convert Notion mention to Markdown
 * Handles: database, page, date, link_mention, user, and other types
 */
function convertMention(richText: any, context?: BlockConversionContext): string {
	const mention = richText.mention;
	if (!mention) return richText.plain_text || '';
	
	const mentionType = mention.type;
	
	switch (mentionType) {
		case 'database':
			// Create placeholder for database mention
			// Record this mention ID for later replacement
			if (context?.mentionedIds) {
				context.mentionedIds.add(mention.database.id);
			}
			return `[[NOTION_DB:${mention.database.id}]]`;
		
		case 'page':
			// Create placeholder for page mention
			// Record this mention ID for later replacement
			if (context?.mentionedIds) {
				context.mentionedIds.add(mention.page.id);
			}
			return `[[NOTION_PAGE:${mention.page.id}]]`;
		
		case 'date':
			// Render date as plain text with spaces
			const dateObj = mention.date;
			let dateText = '';
			if (dateObj.start) {
				dateText = dateObj.start;
				if (dateObj.end) {
					dateText += ` → ${dateObj.end}`;
				}
			}
			return ` ${dateText} `;
		
		case 'link_mention':
			// Render as external link
			const url = mention.link_mention?.href || '';
			// Use plain_text as title if available, otherwise use URL
			const title = richText.plain_text || url;
			return `[${title}](${url})`;
		
		case 'user':
			// Render user as plain text with spaces
			const userName = richText.plain_text || '';
			return ` ${userName} `;
		
		default:
			// For any other mention types, render as plain text with spaces
			const text = richText.plain_text || '';
			return ` ${text} `;
	}
}

