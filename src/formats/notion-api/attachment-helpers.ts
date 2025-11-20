/**
 * Attachment helper functions for Notion API importer
 * Handles downloading and processing attachments (images, files, videos, PDFs)
 */

import { Vault, normalizePath, requestUrl } from 'obsidian';
import { RichTextItemResponse } from '@notionhq/client';
import { sanitizeFileName } from '../../util';
import { splitext, parseFilePath } from '../../filesystem';
import { extensionForMime } from '../../mime';
import { NotionAttachment, AttachmentResult, BlockConversionContext } from './types';
import { getUniqueFilePath } from './vault-helpers';

/**
 * Download an attachment and save it to the vault
 * @param attachment - Attachment information
 * @param context - Block conversion context containing vault, import context, and settings
 * @returns Attachment result with path and metadata
 */
export async function downloadAttachment(
	attachment: NotionAttachment,
	context: BlockConversionContext
): Promise<AttachmentResult> {
	const { vault, ctx, downloadExternalAttachments, currentPageTitle } = context;
	
	// Determine if we should download this attachment
	const shouldDownload = attachment.type === 'file' || (attachment.type === 'external' && downloadExternalAttachments);
	
	if (!shouldDownload) {
		// Return original URL for external files when download is disabled
		return {
			path: attachment.url,
			isLocal: false
		};
	}
	
	// Extract filename early for error reporting
	// Priority: attachment.name > URL extraction > currentPageTitle > 'attachment'
	let filename = attachment.name || extractFilenameFromUrl(attachment.url) || currentPageTitle || 'attachment';
	filename = sanitizeFileName(filename);
	
	try {
		// Download the file first to get Content-Type header
		ctx.status(`Downloading attachment: ${filename}...`);
		const response = await requestUrl({
			url: attachment.url,
			method: 'GET',
			throw: false,
		});
		
		if (response.status !== 200) {
			console.error(`Failed to download attachment "${filename}": ${response.status}`);
			ctx.reportFailed(`Attachment: ${filename}`, `HTTP ${response.status}`);
			return {
				path: attachment.url,
				isLocal: false
			};
		}
		
		// Check if filename has an extension, if not, infer from Content-Type
		const [basename, ext] = splitext(filename);
		if (!ext) {
			const contentType = response.headers['content-type'] || response.headers['Content-Type'];
			if (contentType) {
				const extension = extensionForMime(contentType);
				if (extension) {
					filename = `${basename}.${extension}`;
				}
			}
		}
		
		// Get attachment folder path from vault settings
		const attachmentFolderPath = getAttachmentFolderPath(vault, context.currentFolderPath);
	
		// Get unique file path to avoid conflicts
		const filePath = getUniqueFilePath(vault, attachmentFolderPath, filename);
		
		// Create attachment folder if it doesn't exist
		await ensureAttachmentFolder(vault, attachmentFolderPath);
		
		// Save the file
		await vault.createBinary(normalizePath(filePath), response.arrayBuffer);
		
		// Return the file path without extension (for wiki links) and with extension (for markdown links)
		const { parent, basename: fileBasename } = parseFilePath(filePath);
		const filePathWithoutExt = normalizePath(parent ? `${parent}/${fileBasename}` : fileBasename);
		return {
			path: filePathWithoutExt,
			isLocal: true,
			filename: filename
		};
	}
	catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`Failed to download attachment "${filename}":`, error);
		ctx.reportFailed(`Attachment: ${filename}`, errorMsg);
		return {
			path: attachment.url,
			isLocal: false
		};
	}
}

/**
 * Extract filename from URL
 */
function extractFilenameFromUrl(url: string): string {
	try {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname;
		const segments = pathname.split('/');
		const filename = segments[segments.length - 1];
		
		// Decode URL encoding
		return decodeURIComponent(filename) || 'attachment';
	}
	catch (error) {
		return 'attachment';
	}
}

/**
 * Get attachment folder path from vault settings
 * @param vault - Obsidian vault
 * @param currentFolderPath - Current file's folder path
 * @returns Attachment folder path
 * 
 * Obsidian attachment settings (4 options):
 * 1. Vault folder: attachmentFolderPath = '/' or ''
 * 2. In the folder specified below: attachmentFolderPath = user specified path (e.g., 'assets')
 *    - Does NOT start with './'
 * 3. Same folder as current file: attachmentFolderPath = './'
 * 4. In subfolder under current folder: attachmentFolderPath = './subfoldername' (e.g., './aaa')
 *    - Starts with './' followed by the subfolder name
 */
function getAttachmentFolderPath(vault: Vault, currentFolderPath: string): string {
	// Get attachment folder setting from vault config
	// @ts-ignore - accessing internal API
	const attachmentFolderPath = vault.getConfig('attachmentFolderPath');
	
	// Case 3 & 4: Paths starting with "./" (relative to current file)
	if (attachmentFolderPath && attachmentFolderPath.startsWith('./')) {
		// Extract subfolder name from path like "./aaa" -> "aaa"
		const subfolderName = attachmentFolderPath.substring(2);
		if (subfolderName) {
			// Case 4: In subfolder under current folder (e.g., "./aaa")
			return normalizePath(currentFolderPath ? `${currentFolderPath}/${subfolderName}` : subfolderName);
		}
		else {
			// Case 3: Same folder as current file (just "./")
			return currentFolderPath || '';
		}
	}
	// Case 2: In the folder specified below (custom absolute/relative path)
	// User can specify any path like 'assets', 'files/attachments', etc.
	// This does NOT start with "./"
	else if (attachmentFolderPath && attachmentFolderPath !== '/' && attachmentFolderPath !== '') {
		return attachmentFolderPath;
	}
	// Case 1: Vault folder (root)
	else {
		return '';
	}
}

/**
 * Ensure attachment folder exists
 */
async function ensureAttachmentFolder(vault: Vault, folderPath: string): Promise<void> {
	if (!folderPath) return; // Root folder always exists
	
	try {
		const folder = vault.getAbstractFileByPath(normalizePath(folderPath));
		if (!folder) {
			await vault.createFolder(normalizePath(folderPath));
		}
	}
	catch (error) {
		// Folder might already exist, ignore error
	}
}

/**
 * Extract attachment info from Notion block
 * @param block - Using 'any' because we need to handle multiple block types (image, video, file, pdf)
 *                dynamically based on block.type, and each has different property structures.
 */
export function extractAttachmentFromBlock(block: any): NotionAttachment | null {
	const blockType = block.type;
	
	// Handle different block types
	// Using 'any' because attachment data structure varies by block type (image, video, file, pdf)
	let attachmentData: any = null;
	
	if (blockType === 'image') {
		attachmentData = block.image;
	}
	else if (blockType === 'video') {
		attachmentData = block.video;
	}
	else if (blockType === 'file') {
		attachmentData = block.file;
	}
	else if (blockType === 'pdf') {
		attachmentData = block.pdf;
	}
	else {
		return null;
	}
	
	if (!attachmentData) return null;
	
	// Extract URL based on type
	if (attachmentData.type === 'file' && attachmentData.file) {
		return {
			type: 'file',
			url: attachmentData.file.url,
			name: attachmentData.name,
		};
	}
	else if (attachmentData.type === 'external' && attachmentData.external) {
		return {
			type: 'external',
			url: attachmentData.external.url,
			name: attachmentData.name,
		};
	}
	
	return null;
}

/**
 * Get caption from block
 * @param block - Using 'any' because we need to handle multiple block types (image, video, file, pdf, bookmark, embed)
 *                dynamically, and each has different caption property structures.
 */
export function getCaptionFromBlock(block: any): string {
	const blockType = block.type;
	let captionArray: RichTextItemResponse[] = [];
	
	if (blockType === 'image' && block.image.caption) {
		captionArray = block.image.caption;
	}
	else if (blockType === 'video' && block.video.caption) {
		captionArray = block.video.caption;
	}
	else if (blockType === 'file' && block.file.caption) {
		captionArray = block.file.caption;
	}
	else if (blockType === 'pdf' && block.pdf.caption) {
		captionArray = block.pdf.caption;
	}
	else if (blockType === 'bookmark' && block.bookmark.caption) {
		captionArray = block.bookmark.caption;
	}
	else if (blockType === 'link_preview' && block.link_preview.caption) {
		captionArray = block.link_preview.caption;
	}
	else if (blockType === 'embed' && block.embed.caption) {
		captionArray = block.embed.caption;
	}
	
	// Convert rich text to plain text
	return captionArray.map(t => t.plain_text).join('') || '';
}

/**
 * Format attachment link according to vault settings
 * @param result - Attachment download result
 * @param vault - Obsidian vault
 * @param caption - Optional caption/alt text
 * @param isEmbed - Whether to use embed syntax (!) for images/videos/pdfs
 * @returns Formatted markdown link
 */
export function formatAttachmentLink(
	result: AttachmentResult,
	vault: Vault,
	caption: string = '',
	isEmbed: boolean = false
): string {
	// If not local (still a URL), use standard markdown syntax
	if (!result.isLocal) {
		if (isEmbed) {
			return `![${caption}](${result.path})`;
		}
		else {
			return `[${caption || 'Link'}](${result.path})`;
		}
	}
	
	// Get user's link format preference
	const useWikiLinks = vault.getConfig('useWikiLinks') ?? true;
	
	// Determine display text: prioritize caption, fallback to filename
	const displayText = caption || result.filename || result.path;
	
	if (useWikiLinks) {
		// Use Obsidian wiki link format
		const embedPrefix = isEmbed ? '!' : '';
		
		// For wiki links, we need to include the file extension
		// Obsidian requires the extension to properly link to non-markdown files
		const pathWithExt = result.filename ? `${result.path}.${getFileExtension(result.filename)}` : result.path;
		
		if (caption) {
			// If caption exists, use it as display text
			return `${embedPrefix}[[${pathWithExt}|${caption}]]`;
		}
		else {
			// If no caption, just use the file path with extension
			return `${embedPrefix}[[${pathWithExt}]]`;
		}
	}
	else {
		// Use standard markdown format
		// Need to add extension back for markdown links
		const pathWithExt = result.filename ? `${result.path}.${getFileExtension(result.filename)}` : result.path;
		
		if (isEmbed) {
			return `![${displayText}](${pathWithExt})`;
		}
		else {
			return `[${displayText}](${pathWithExt})`;
		}
	}
}

/**
 * Get file extension from filename
 */
function getFileExtension(filename: string): string {
	const lastDotIndex = filename.lastIndexOf('.');
	if (lastDotIndex > 0) {
		return filename.substring(lastDotIndex + 1);
	}
	return '';
}

