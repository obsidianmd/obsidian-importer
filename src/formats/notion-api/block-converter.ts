/**
 * Block conversion functions for Notion API importer
 * Converts Notion blocks to Markdown format
 */

import { 
	BlockObjectResponse, 
	Client,
	ToggleBlockObjectResponse,
	TableBlockObjectResponse,
	TableRowBlockObjectResponse,
	CalloutBlockObjectResponse,
	EquationBlockObjectResponse,
	BookmarkBlockObjectResponse,
	EmbedBlockObjectResponse,
	LinkPreviewBlockObjectResponse,
	RichTextItemResponse
} from '@notionhq/client';
import { normalizePath } from 'obsidian';
import { ImportContext } from '../../main';
import { parseFilePath } from '../../filesystem';
import { sanitizeFileName } from '../../util';
import { getBlockChildren, processBlockChildren } from './api-helpers';
import { downloadAttachment, extractAttachmentFromBlock, getCaptionFromBlock, formatAttachmentLink } from './attachment-helpers';
import { BlockConversionContext, AttachmentType, AttachmentBlockConfig } from './types';
import { createPlaceholder, extractPlaceholderIds, PlaceholderType } from './utils';


/**
 * Predefined configurations for each attachment type
 */
export const ATTACHMENT_CONFIGS: Record<AttachmentType, Omit<AttachmentBlockConfig, 'beforeDownload'>> = {
	[AttachmentType.IMAGE]: {
		type: AttachmentType.IMAGE,
		isEmbed: true,
		fallbackText: 'Image'
	},
	[AttachmentType.VIDEO]: {
		type: AttachmentType.VIDEO,
		isEmbed: true,
		fallbackText: 'Video'
	},
	[AttachmentType.FILE]: {
		type: AttachmentType.FILE,
		isEmbed: false,
		fallbackText: 'File'
	},
	[AttachmentType.PDF]: {
		type: AttachmentType.PDF,
		isEmbed: true,
		fallbackText: 'PDF'
	}
};

/**
 * Helper function to process block children and convert them to markdown
 * This is a common pattern used in list items, callouts, toggles, etc.
 * 
 * @param block - The parent block
 * @param context - Block conversion context
 * @param indentLevel - Optional indent level for nested children (undefined = use context's indentLevel)
 * @param errorContext - Context string for error messages
 * @returns Markdown string or undefined if no children
 */
async function processChildrenToMarkdown(
	block: BlockObjectResponse,
	context: BlockConversionContext,
	indentLevel: number | undefined,
	errorContext: string
): Promise<string | undefined> {
	return await processBlockChildren({
		block,
		client: context.client,
		ctx: context.ctx,
		blocksCache: context.blocksCache,
		processor: async (children) => {
			const childContext = indentLevel !== undefined 
				? { ...context, indentLevel }
				: context;
			return await convertBlocksToMarkdown(children, childContext);
		},
		errorContext
	});
}

/**
 * Check if a block is an empty paragraph
 */
function isEmptyParagraph(block: BlockObjectResponse | null | undefined): boolean {
	if (!block || block.type !== 'paragraph') {
		return false;
	}
	return block.paragraph.rich_text.length === 0;
}

/**
 * Determine if spacing (empty line) should be added between two blocks
 * Based on STRICT Markdown syntax requirements ONLY
 * 
 * Philosophy: Render blocks as-is without adding extra spacing,
 * EXCEPT where Markdown syntax absolutely requires it for correct rendering.
 * 
 * Rules:
 * 1. List ↔ Non-list transition: MUST have spacing at top level (Markdown requirement)
 *    BUT NOT in nested contexts (indentLevel > 0) where indentation handles separation
 * 2. Callout/Toggle blocks: MUST have spacing (Obsidian requirement)
 * 3. Table blocks: MUST have spacing (Markdown requirement)
 * 4. If Notion already has empty paragraph, don't add extra spacing
 */
function shouldAddSpacingBetweenBlocks(
	currentType: string, 
	nextType: string, 
	context?: BlockConversionContext
): boolean {
	// Define list types (including to_do)
	const listTypes = ['bulleted_list_item', 'numbered_list_item', 'to_do'];
	
	const currentIsList = listTypes.includes(currentType);
	const nextIsList = listTypes.includes(nextType);
	
	// Rule 1: List ↔ Non-list transition requires spacing
	// BUT ONLY at top level (indentLevel = 0)
	// In nested contexts (indentLevel > 0), indentation handles the separation
	if (currentIsList !== nextIsList) {
		const indentLevel = context?.indentLevel || 0;
		// Only add spacing if at top level (not nested)
		return indentLevel === 0;
	}
	
	// Rule 2: Callout/Toggle blocks require spacing between them
	// Obsidian callout syntax requires empty lines to separate consecutive callouts
	const calloutTypes = ['callout', 'toggle'];
	if (calloutTypes.includes(currentType) || calloutTypes.includes(nextType)) {
		return true;
	}
	
	// Rule 3: Table blocks require spacing before and after
	// Markdown table syntax requires empty lines to properly render
	if (currentType === 'table' || nextType === 'table') {
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
		
		// Reset list counters for deeper levels when we encounter a non-numbered-list block
		// This ensures proper numbering when switching between list types or exiting nested lists
		if (block.type !== 'numbered_list_item' && context.listCounters) {
			const currentIndent = context.indentLevel || 0;
			// Clear counters for all levels deeper than current
			const keysToDelete: number[] = [];
			context.listCounters.forEach((_, level) => {
				if (level > currentIndent) {
					keysToDelete.push(level);
				}
			});
			keysToDelete.forEach(key => context.listCounters!.delete(key));
		}
		
		const markdown = await convertBlockToMarkdown(block, context);
	
		// Special handling for empty paragraphs: preserve them as empty lines
		// This respects Notion's explicit spacing intent
		if (markdown === '' && block.type === 'paragraph') {
			lines.push('');
		}
		else if (markdown) {
			lines.push(markdown);
		
			// Smart spacing: Add empty lines only when necessary AND not already present
			// Check if next block exists and if spacing is required
			if (i < blocks.length - 1) {
				const nextBlock = blocks[i + 1];
			
				// Check if Notion already has an empty paragraph between blocks
				const nextIsEmpty = isEmptyParagraph(nextBlock);
			
				// Only add spacing if:
				// 1. Markdown syntax requires it (list transitions, callouts, etc.)
				// 2. Notion doesn't already have an empty paragraph
				if (shouldAddSpacingBetweenBlocks(block.type, nextBlock.type, context) && !nextIsEmpty) {
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
	
		case 'table':
			markdown = await convertTable(block, context);
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
			const dbIndentLevel = context.indentLevel || 0;
	
			// Choose placeholder type based on context
			const placeholderType = isInSyncedBlockDb 
				? PlaceholderType.SYNCED_CHILD_DATABASE 
				: PlaceholderType.DATABASE_PLACEHOLDER;
			const placeholder = createPlaceholder(placeholderType, block.id);
		
			if (dbIndentLevel > 0) {
			// In a list: render with indentation only (no bullet)
				const dbIndent = '    '.repeat(dbIndentLevel);
				markdown = dbIndent + placeholder;
			}
			else {
			// Top level: render directly
				markdown = placeholder;
			}
			break;
		
		case 'child_page':
		// Child page blocks: import the page and return a link
		// Special handling for pages inside synced blocks
			const isInSyncedBlock = context.currentFolderPath?.includes('Notion Synced Blocks');
			const pageIndentLevel = context.indentLevel || 0;
		
			if (isInSyncedBlock) {
				// Inside synced block: check if already imported, otherwise use placeholder
				const pageId = block.id;
				// For now, always use placeholder and handle in replacement phase
				// Return placeholder that will be replaced later
				const placeholder = createPlaceholder(PlaceholderType.SYNCED_CHILD_PAGE, pageId);
				if (pageIndentLevel > 0) {
					// In a list: render with indentation only (no bullet)
					const pageIndent = '    '.repeat(pageIndentLevel);
					markdown = pageIndent + placeholder;
				}
				else {
					// Top level: render directly
					markdown = placeholder;
				}
			}
			else if (context.importPageCallback) {
			// Normal page: import the child page
				// Get page title from block (extract before try-catch so we can use it in error reporting)
				const pageTitle = block.child_page?.title || 'Untitled';
				
				try {
					// Import the child page under current folder
					await context.importPageCallback(block.id, context.currentFolderPath);
					
					// Return a wiki link to the child page
					if (pageIndentLevel > 0) {
						// In a list: render with indentation only (no bullet)
						const pageIndent = '    '.repeat(pageIndentLevel);
						markdown = pageIndent + `[[${pageTitle}]]`;
					}
					else {
						// Top level: render directly
						markdown = `[[${pageTitle}]]`;
					}
				}
				catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					console.error(`Failed to import child page "${pageTitle}":`, error);
					context.ctx.reportFailed(`Child page: ${pageTitle}`, errorMsg);
					markdown = `<!-- Failed to import child page: ${errorMsg} -->`;
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
	// Get indent level if heading is nested in a list
	const indentLevel = context?.indentLevel || 0;
	const indent = '    '.repeat(indentLevel); // 4 spaces per indent level
	
	let headingText = '';
	if (block.type === 'heading_1') {
		headingText = '# ' + convertRichText(block.heading_1.rich_text, context);
	}
	else if (block.type === 'heading_2') {
		headingText = '## ' + convertRichText(block.heading_2.rich_text, context);
	}
	else if (block.type === 'heading_3') {
		headingText = '### ' + convertRichText(block.heading_3.rich_text, context);
	}
	
	// Add indentation if nested
	return indent + headingText;
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
	const indent = '    '.repeat(indentLevel); // 4 spaces per indent level
	let markdown = indent + '- ' + convertRichText(block.bulleted_list_item.rich_text, context);
	
	// Process children if they exist
	const childrenMarkdown = await processChildrenToMarkdown(
		block,
		context,
		indentLevel + 1,
		'bulleted list item'
	);
	
	if (childrenMarkdown) {
		markdown += '\n' + childrenMarkdown;
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
	const indent = '    '.repeat(indentLevel); // 4 spaces per indent level
	
	// Use [x] for checked items, [ ] for unchecked
	const checkbox = block.to_do.checked ? '[x]' : '[ ]';
	let markdown = indent + '- ' + checkbox + ' ' + convertRichText(block.to_do.rich_text, context);
	
	// Process children if they exist
	const childrenMarkdown = await processChildrenToMarkdown(
		block,
		context,
		indentLevel + 1,
		'to-do item'
	);
	
	if (childrenMarkdown) {
		markdown += '\n' + childrenMarkdown;
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
	const markdown = await processBlockChildren({
		block,
		client: context.client,
		ctx: context.ctx,
		blocksCache: context.blocksCache,
		processor: async (columns) => {
			let result = '';
			
			// Process each column from left to right
			for (let i = 0; i < columns.length; i++) {
				const column = columns[i];
				
				if (column.type !== 'column') {
					console.warn(`Expected column block, got ${column.type}`);
					continue;
				}
				
				// Add column marker comment
				result += `<!-- Column ${i + 1} -->\n`;
				
				// Convert the column's content
				const columnMarkdown = await convertColumn(column, context);
				if (columnMarkdown) {
					result += columnMarkdown;
				}
				
				// Add spacing between columns (but not after the last one)
				if (i < columns.length - 1) {
					result += '\n\n';
				}
			}
			
			return result;
		},
		errorContext: 'column_list'
	});
	
	return markdown || '';
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
	const markdown = await processChildrenToMarkdown(
		block,
		context,
		undefined, // Keep current indentLevel
		'column'
	);
	
	return markdown || '';
}

/**
 * Extract the first line of text from a block recursively
 * Used for naming synced block files
 */
async function extractFirstLineText(
	block: BlockObjectResponse,
	client: Client,
	ctx: ImportContext,
	maxLength: number = 20,
	blocksCache?: Map<string, BlockObjectResponse[]>
): Promise<string> {
	// Try to get text from the block itself
	let text = '';
	
	// Extract text based on block type
	// Using 'as any' here because TypeScript cannot infer the correct type for dynamic property access
	// on a union type (BlockObjectResponse). Each block type (paragraph, heading_1, etc.) has its own
	// property with the same name, and we need to access it dynamically based on block.type.
	// The alternative would be a verbose if-else chain for each block type, which is not maintainable.
	if ('rich_text' in (block as any)[block.type]) {
		const richText = (block as any)[block.type].rich_text;
		if (richText && richText.length > 0) {
			text = richText.map((rt: RichTextItemResponse) => rt.plain_text || '').join('');
		}
	}
	
	// If we found text, return it (truncated)
	if (text.trim()) {
		return text.trim().substring(0, maxLength);
	}
	
	// If no text found and block has children, recursively check first child
	const firstChildText = await processBlockChildren({
		block,
		client,
		ctx,
		blocksCache,
		processor: async (children) => {
			return await extractFirstLineText(children[0], client, ctx, maxLength, blocksCache);
		},
		errorContext: 'first line text extraction'
	});
	
	if (firstChildText) {
		return firstChildText;
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
	
	// Default filename for error reporting
	let fileName = 'Synced Block';
	
	try {
		// Fetch the block to get its content
		const retrievedBlock = await client.blocks.retrieve({ block_id: blockId });
		
		// Check if it's a full block (not partial)
		if (!('type' in retrievedBlock)) {
			throw new Error(`Retrieved block ${blockId} is partial, cannot process synced block`);
		}
		
		const block = retrievedBlock as BlockObjectResponse;
		
		// Get the block's children (the actual content)
		const children: BlockObjectResponse[] = block.has_children 
			? await getBlockChildren(blockId, client, ctx, context.blocksCache)
			: [];

		// Extract first line text for filename
		if (children.length > 0) {
			fileName = await extractFirstLineText(children[0], client, ctx, 20, context.blocksCache);
		}
		
		// Sanitize filename
		fileName = sanitizeFileName(fileName.trim()) || 'Synced Block';
	
		// Create "Notion Synced Blocks" folder at the same level as output root
		const { parent: parentPath } = parseFilePath(outputRootPath);
		const syncedBlocksFolder = normalizePath(
			parentPath ? `${parentPath}/Notion Synced Blocks` : 'Notion Synced Blocks'
		);

		// Check if folder exists before creating
		const existingFolder = vault.getAbstractFileByPath(syncedBlocksFolder);
		if (!existingFolder) {
			try {
				await vault.createFolder(syncedBlocksFolder);
			}
			catch (error) {
			// Ignore error if folder was created by another concurrent operation
				if (!error.message?.includes('already exists')) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					console.error('Failed to create Notion Synced Blocks folder:', error);
					context.ctx.reportFailed('Create Synced Blocks folder', errorMsg);
				}
			}
		}
		
		// Generate unique file path
		let filePath = normalizePath(`${syncedBlocksFolder}/${fileName}.md`);
		let counter = 1;
		while (vault.getAbstractFileByPath(filePath)) {
			filePath = normalizePath(`${syncedBlocksFolder}/${fileName} (${counter}).md`);
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
		// Separated by type to avoid unnecessary placeholder checks during replacement

		// Find SYNCED_CHILD_PAGE placeholders
		const pageIds = extractPlaceholderIds(markdown, PlaceholderType.SYNCED_CHILD_PAGE);
		if (context.syncedChildPagePlaceholders && pageIds.length > 0) {
			const existingPageIds = context.syncedChildPagePlaceholders.get(filePath) || new Set<string>();
			pageIds.forEach(id => existingPageIds.add(id));
			context.syncedChildPagePlaceholders.set(filePath, existingPageIds);
		}

		// Find SYNCED_CHILD_DATABASE placeholders
		const dbIds = extractPlaceholderIds(markdown, PlaceholderType.SYNCED_CHILD_DATABASE);
		if (context.syncedChildDatabasePlaceholders && dbIds.length > 0) {
			const existingDbIds = context.syncedChildDatabasePlaceholders.get(filePath) || new Set<string>();
			dbIds.forEach(id => existingDbIds.add(id));
			context.syncedChildDatabasePlaceholders.set(filePath, existingDbIds);
		}
	
		// Create the file
		await vault.create(filePath, markdown);
		
		console.log(`Created synced block file: ${filePath}`);
		
		return filePath;
	}
	catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`Failed to create synced block file "${fileName}":`, error);
		context.ctx.reportFailed(`Synced block: ${fileName}`, errorMsg);
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
	
	const syncedBlockData = block.synced_block;
	if (!syncedBlockData) return '';
	
	const { syncedBlocksMap } = context;
	if (!syncedBlocksMap) {
		console.error('syncedBlocksMap is required for synced blocks');
		return '';
	}
	
	// Determine if this is an original block or a synced copy
	const isOriginal = syncedBlockData.synced_from === null;
	// If don't use the ! assertion, TypeScript will throw an error.
	const originalBlockId = isOriginal ? block.id : syncedBlockData.synced_from!.block_id;
	
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
			// Error is already reported inside createSyncedBlockFile with proper filename
			// Just return error comment
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`Failed to process synced block ${originalBlockId}:`, error);
			return `<!-- Failed to import synced block: ${errorMsg} -->`;
		}
	}
	
	// Extract filename without extension for wiki link
	const { basename } = parseFilePath(filePath);
	
	// Return wiki link to the synced block file
	return `![[${basename}]]`;
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
	
	const toggleBlock = block as ToggleBlockObjectResponse;
	const toggleData = toggleBlock.toggle;
	
	// Get toggle text
	const text = convertRichText(toggleData.rich_text, context);
	
	// In Notion API, we can't directly get the toggle state (expanded/collapsed)
	// So we default to expanded (+) which is more user-friendly
	// Users can manually change it to (-) if they want it collapsed by default
	const foldState = '+'; // Default to expanded (foldable)
	
	// Create Obsidian foldable callout
	// Using 'note' type as default for toggles
	let markdown = `> [!note]${foldState} ${text}\n`;
	
	// Process children if they exist
	const childrenMarkdown = await processChildrenToMarkdown(
		block,
		context,
		0, // Don't pass indentLevel to toggle children, '> ' prefix is sufficient
		'toggle block'
	);
	
	if (childrenMarkdown) {
		// Indent children content with '> ' for callout
		const indentedChildren = childrenMarkdown.split('\n').map(line => `> ${line}`).join('\n');
		markdown += indentedChildren;
	}
	
	return markdown;
}

/**
 * Convert Notion table to Markdown table
 * Supports column headers, row headers, and inline elements (mention, link, math, etc.)
 */
export async function convertTable(
	block: BlockObjectResponse,
	context: BlockConversionContext
): Promise<string> {
	if (block.type !== 'table') return '';
	
	const tableBlock = block as TableBlockObjectResponse;
	const tableData = tableBlock.table;
	
	// Table configuration
	const tableWidth = tableData.table_width || 0;
	// ignore table's column header & row header
	
	// Column alignment (default: left-aligned, can be modified later)
	const columnAlignment: ('left' | 'center' | 'right')[] = new Array(tableWidth).fill('left');
	
	// Fetch table rows (children of table block)
	const markdownRows = await processBlockChildren({
		block,
		client: context.client,
		ctx: context.ctx,
		blocksCache: context.blocksCache,
		processor: async (rows) => {
			const result: string[] = [];
			
			// Convert each row
			for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
				const row = rows[rowIndex];
				if (row.type !== 'table_row') continue;
				
				const rowBlock = row as TableRowBlockObjectResponse;
				const rowData = rowBlock.table_row;
				if (!rowData.cells) continue;
				
				const cells = rowData.cells; // Array of RichText arrays
				const markdownCells: string[] = [];
				
				for (let colIndex = 0; colIndex < cells.length; colIndex++) {
					const cellRichText = cells[colIndex];
					
					// Convert RichText to markdown
					let cellContent = convertRichText(cellRichText, context);
					
					// Handle hard line breaks (replace \n with <br>)
					cellContent = cellContent.replace(/\n/g, '<br>');
					
					// Handle empty cells
					if (!cellContent.trim()) {
						cellContent = ' '; // Keep at least one space for proper table rendering
					}
					
					markdownCells.push(cellContent);
				}
				
				// Build row string
				result.push('| ' + markdownCells.join(' | ') + ' |');
				
				// Add separator row after first row
				// Markdown tables require a separator row, which makes the first row a header
				if (rowIndex === 0) {
					const separators = columnAlignment.map(align => {
						switch (align) {
							case 'left':
								return '---';
							case 'center':
								return ':---:';
							case 'right':
								return '---:';
							default:
								return '---';
						}
					});
					result.push('| ' + separators.join(' | ') + ' |');
				}
			}
			
			return result;
		},
		errorContext: 'table'
	});
	
	if (!markdownRows || markdownRows.length === 0) {
		return ''; // Empty table
	}
	
	return markdownRows.join('\n');
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
	
	// Initialize listCounters if not present
	if (!context.listCounters) {
		context.listCounters = new Map<number, number>();
	}
	
	// Get current counter for this indent level, or initialize to 1
	const currentNumber = (context.listCounters.get(indentLevel) || 0) + 1;
	context.listCounters.set(indentLevel, currentNumber);
	
	// Use 4 spaces per indent level
	const indent = '    '.repeat(indentLevel);
	let markdown = indent + `${currentNumber}. ` + convertRichText(block.numbered_list_item.rich_text, context);
	
	// Process children if they exist
	const childrenMarkdown = await processChildrenToMarkdown(
		block,
		context,
		indentLevel + 1,
		'numbered list item'
	);
	
	if (childrenMarkdown) {
		markdown += '\n' + childrenMarkdown;
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
	
	const calloutBlock = block as CalloutBlockObjectResponse;
	const calloutData = calloutBlock.callout;
	
	// Get callout icon and text
	const icon = (calloutData.icon && 'emoji' in calloutData.icon) ? calloutData.icon.emoji : '📌';
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
	
	// Process children if they exist
	const childrenMarkdown = await processChildrenToMarkdown(
		block,
		context,
		0, // Don't increase indentLevel for callout children, '> ' prefix is sufficient
		'callout block'
	);
	
	if (childrenMarkdown) {
		// Indent children content with '> ' for callout
		const indentedChildren = childrenMarkdown.split('\n').map(line => `> ${line}`).join('\n');
		markdown += '\n' + indentedChildren;
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
	
	const equationBlock = block as EquationBlockObjectResponse;
	const equationData = equationBlock.equation;
	if (!equationData.expression) return '';
	
	// Obsidian uses $$ for block-level math
	return `$$\n${equationData.expression}\n$$`;
}

/**
 * Generic attachment converter
 * Handles the common logic for image, video, file, and PDF blocks
 */
async function convertAttachmentBlock(
	block: BlockObjectResponse,
	context: BlockConversionContext,
	config: AttachmentBlockConfig
): Promise<string> {
	const { type, isEmbed, fallbackText, beforeDownload } = config;
	
	const attachment = extractAttachmentFromBlock(block);
	if (!attachment) return '';
	
	const caption = getCaptionFromBlock(block);
	
	// Allow custom logic before download (e.g., YouTube check for videos)
	if (beforeDownload) {
		const earlyResult = beforeDownload(attachment, block);
		if (earlyResult !== null) return earlyResult;
	}
	
	try {
		const result = await downloadAttachment(attachment, context);
		
		// Report progress if attachment was downloaded
		if (result.isLocal && context.onAttachmentDownloaded) {
			context.onAttachmentDownloaded();
		}
		
		// Format link according to user's vault settings
		return formatAttachmentLink(result, context.vault, caption, isEmbed);
	}
	catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`Failed to convert ${type} block:`, error);
		context.ctx.reportFailed(`${type.charAt(0).toUpperCase() + type.slice(1)} attachment`, errorMsg);
		
		// If download failed, return a fallback markdown link with the original URL
		const linkText = caption || attachment.name || fallbackText;
		const linkPrefix = isEmbed ? '!' : '';
		return `${linkPrefix}[${linkText}](${attachment.url})`;
	}
}

/**
 * Convert image block to Markdown
 */
export async function convertImage(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'image') return '';
	return convertAttachmentBlock(block, context, ATTACHMENT_CONFIGS[AttachmentType.IMAGE]);
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
	
	return convertAttachmentBlock(block, context, {
		...ATTACHMENT_CONFIGS[AttachmentType.VIDEO],
		beforeDownload: (attachment, block) => {
			// For external YouTube videos, use embed syntax directly without downloading
			if (attachment.type === 'external' && isYouTubeUrl(attachment.url)) {
				const caption = getCaptionFromBlock(block);
				return `![${caption || ''}](${attachment.url})`;
			}
			return null; // Continue with normal download
		}
	});
}

/**
 * Convert file block to Markdown
 */
export async function convertFile(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'file') return '';
	return convertAttachmentBlock(block, context, ATTACHMENT_CONFIGS[AttachmentType.FILE]);
}

/**
 * Convert PDF block to Markdown
 */
export async function convertPdf(block: BlockObjectResponse, context: BlockConversionContext): Promise<string> {
	if (block.type !== 'pdf') return '';
	return convertAttachmentBlock(block, context, ATTACHMENT_CONFIGS[AttachmentType.PDF]);
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
	
	const bookmarkBlock = block as BookmarkBlockObjectResponse;
	const bookmarkData = bookmarkBlock.bookmark;
	
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
	
	const embedBlock = block as EmbedBlockObjectResponse;
	const embedData = embedBlock.embed;
	
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
	
	const linkPreviewBlock = block as LinkPreviewBlockObjectResponse;
	const linkPreviewData = linkPreviewBlock.link_preview;
	
	const url = linkPreviewData.url || '';
	
	// Link previews are preview cards in Notion, not embedded content
	// So always return a simple markdown link, even for YouTube/Twitter
	return `[${url}](${url})`;
}

/**
 * Convert Notion rich text to plain Markdown text with formatting
 * Handles inline elements: text, mentions, equations, links, and annotations
 */
export function convertRichText(richTextArray: RichTextItemResponse[], context?: BlockConversionContext): string {
	if (!richTextArray || richTextArray.length === 0) return '';
	
	return richTextArray.map(rt => {
		const type = rt.type;
		let text = '';
		
		// Handle different rich text types
		if (type === 'text') {
			text = rt.plain_text || '';
		}
		else if (type === 'mention') {
			// Using 'any' because convertMention expects the full rich text object with mention property
			text = convertMention(rt as any, context);
		}
		else if (type === 'equation') {
			// Inline equation using single $
			// Trim whitespace to ensure proper rendering in Obsidian
			text = `$${(rt.equation?.expression || '').trim()}$`;
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
 * @param richText - Using 'any' because we need to access the 'mention' property which has different
 *                   structures (DatabaseMention | PageMention | DateMention | LinkMention | UserMention)
 *                   and we handle each type by checking mention.type at runtime.
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
			return createPlaceholder(PlaceholderType.NOTION_DB, mention.database.id);
		
		case 'page':
			// Create placeholder for page mention
			// Record this mention ID for later replacement
			if (context?.mentionedIds) {
				context.mentionedIds.add(mention.page.id);
			}
			return createPlaceholder(PlaceholderType.NOTION_PAGE, mention.page.id);
		
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
			// Prioritize link_mention.title, fallback to plain_text, then URL
			const title = mention.link_mention?.title || richText.plain_text || url;
			return `[${title}](${url})`;
		
		case 'user':
		// Render user as markdown link with email if available
			const user = mention.user;
			if (user) {
				const userName = user.name || richText.plain_text || '';
				// Check if user has email
				if (user.type === 'person' && user.person?.email) {
					return ` [${userName}](mailto:${user.person.email}) `;
				}
				return ` ${userName} `;
			}
			// Fallback to plain text
			const userName = richText.plain_text || '';
			return ` ${userName} `;
		
		default:
			// For any other mention types, render as plain text with spaces
			const text = richText.plain_text || '';
			return ` ${text} `;
	}
}

