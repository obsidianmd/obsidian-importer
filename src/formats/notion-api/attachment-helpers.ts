/**
 * Attachment helper functions for Notion API importer
 * Handles downloading and processing attachments (images, files, videos, PDFs)
 */

import { Vault, normalizePath, requestUrl } from 'obsidian';
import { ImportContext } from '../../main';
import { sanitizeFileName } from '../../util';

/**
 * Attachment information from Notion
 */
export interface NotionAttachment {
	type: 'file' | 'external';
	url: string;
	name?: string;
	caption?: string;
}

/**
 * Result of attachment download
 */
export interface AttachmentResult {
	/** Path to the file (without extension for wiki links) or URL */
	path: string;
	/** Whether the file was downloaded locally */
	isLocal: boolean;
	/** Original filename with extension */
	filename?: string;
}

/**
 * Download an attachment and save it to the vault
 * @param attachment - Attachment information
 * @param vault - Obsidian vault
 * @param ctx - Import context
 * @param downloadExternal - Whether to download external URLs
 * @returns Attachment result with path and metadata
 */
export async function downloadAttachment(
	attachment: NotionAttachment,
	vault: Vault,
	ctx: ImportContext,
	downloadExternal: boolean
): Promise<AttachmentResult> {
	// Determine if we should download this attachment
	const shouldDownload = attachment.type === 'file' || (attachment.type === 'external' && downloadExternal);
	
	if (!shouldDownload) {
		// Return original URL for external files when download is disabled
		return {
			path: attachment.url,
			isLocal: false
		};
	}
	
	try {
		// Extract filename from URL or use provided name
		let filename = attachment.name || extractFilenameFromUrl(attachment.url);
		filename = sanitizeFileName(filename);
		
		// Get attachment folder path from vault settings
		const attachmentFolderPath = getAttachmentFolderPath(vault);
		
		// Get unique file path to avoid conflicts
		const filePath = getUniqueAttachmentPath(vault, attachmentFolderPath, filename);
		
		// Download the file
		ctx.status(`Downloading attachment: ${filename}...`);
		const response = await requestUrl({
			url: attachment.url,
			method: 'GET',
			throw: false,
		});
		
		if (response.status !== 200) {
			console.error(`Failed to download attachment ${attachment.url}: ${response.status}`);
			return {
				path: attachment.url,
				isLocal: false
			};
		}
		
		// Create attachment folder if it doesn't exist
		await ensureAttachmentFolder(vault, attachmentFolderPath);
		
		// Save the file
		await vault.createBinary(normalizePath(filePath), response.arrayBuffer);
		
		// Return the file path without extension (for wiki links) and with extension (for markdown links)
		const filePathWithoutExt = filePath.replace(/\.[^/.]+$/, '');
		return {
			path: filePathWithoutExt,
			isLocal: true,
			filename: filename
		};
	}
	catch (error) {
		console.error(`Failed to download attachment ${attachment.url}:`, error);
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
 */
function getAttachmentFolderPath(vault: Vault): string {
	// Get attachment folder setting from vault config
	// @ts-ignore - accessing internal API
	const config = vault.getConfig('attachmentFolderPath');
	
	if (config === './') {
		// Same folder as current file - we'll use root for now
		return '';
	}
	else if (config && config !== '/') {
		// Specific folder
		return config;
	}
	else {
		// Root folder
		return '';
	}
}

/**
 * Get unique attachment path to avoid conflicts
 */
function getUniqueAttachmentPath(vault: Vault, folderPath: string, filename: string): string {
	const basePath = folderPath ? `${folderPath}/${filename}` : filename;
	let finalPath = basePath;
	let counter = 1;
	
	// Extract name and extension
	const lastDotIndex = filename.lastIndexOf('.');
	const nameWithoutExt = lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
	const ext = lastDotIndex > 0 ? filename.substring(lastDotIndex) : '';
	
	while (vault.getAbstractFileByPath(normalizePath(finalPath))) {
		const newFilename = `${nameWithoutExt} (${counter})${ext}`;
		finalPath = folderPath ? `${folderPath}/${newFilename}` : newFilename;
		counter++;
	}
	
	return finalPath;
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
 */
export function extractAttachmentFromBlock(block: any): NotionAttachment | null {
	const blockType = block.type;
	
	// Handle different block types
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
 */
export function getCaptionFromBlock(block: any): string {
	const blockType = block.type;
	let captionArray: any[] = [];
	
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
	return captionArray.map((t: any) => t.plain_text).join('') || '';
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
		if (caption) {
			// If caption exists, use it as display text
			return `${embedPrefix}[[${result.path}|${caption}]]`;
		}
		else {
			// If no caption, just use the file path (Obsidian will show filename automatically)
			return `${embedPrefix}[[${result.path}]]`;
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

