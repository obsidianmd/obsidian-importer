/**
 * Attachment helper functions for Notion API importer
 * Handles downloading and processing attachments (images, files, videos, PDFs)
 */

import { normalizePath, requestUrl, TFile } from 'obsidian';
import { RichTextItemResponse } from '@notionhq/client';
import { sanitizeFileName } from '../../util';
import { splitext, parseFilePath } from '../../filesystem';
import { extensionForMime } from '../../mime';
import { NotionAttachment, AttachmentResult, BlockConversionContext, FormatAttachmentLinkParams } from './types';

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
	const { vault, ctx, downloadExternalAttachments, currentPageTitle, incrementalImport } = context;
	
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
	
		// Get the source file path for attachment folder resolution
		const sourceFilePath = context.currentFilePath || context.currentFolderPath;

		// Use Obsidian's built-in method to get the correct attachment path
		// This respects user's attachment folder settings automatically
		// If file exists, this will add " 1", " 2" suffix
		const targetFilePath = await context.app.fileManager.getAvailablePathForAttachment(filename, sourceFilePath);
	
		console.log(`[ATTACHMENT] Incremental import enabled: ${incrementalImport}, Original filename: ${filename}`);
		console.log(`[ATTACHMENT] Available target path: ${targetFilePath}`);

		// Check for incremental import: skip if file exists with same size
		if (incrementalImport) {
		// Extract the basename from the target path to see if filename was changed
			const { parent: targetParent, basename: targetBasename } = parseFilePath(targetFilePath);
			// Reconstruct the full filename with extension
			const targetFullName = targetBasename + (ext ? `.${ext}` : '');
		
			console.log(`[ATTACHMENT] Target full filename: ${targetFullName}`);
		
			// If filename changed (e.g., "file.jpg" → "file 1.jpg"), it means the original file exists
			if (targetFullName !== filename) {
				console.log(`[ATTACHMENT] Filename changed (${filename} → ${targetFullName}), original file exists`);
			
				// Construct the original file path by replacing the changed filename with the original
				const originalFilePath = normalizePath(`${targetParent}/${filename}`);
			
				console.log(`[ATTACHMENT] Checking original file: ${originalFilePath}`);
				const existingFile = vault.getAbstractFileByPath(originalFilePath);
			
				if (existingFile && existingFile instanceof TFile) {
					const downloadedSize = response.arrayBuffer.byteLength;
					console.log(`[ATTACHMENT] Downloaded size: ${downloadedSize} bytes, Existing size: ${existingFile.stat.size} bytes`);
				
					// Compare file sizes
					if (existingFile.stat.size === downloadedSize) {
						console.log(`[ATTACHMENT] Skipping attachment (same size): ${filename}`);
						ctx.reportSkipped(`Attachment: ${filename}`, 'already exists with same size (incremental import)');
					
						// Return existing file path (don't save to disk)
						const { parent: existingParent, basename: existingBasename } = parseFilePath(originalFilePath);
						const filePathWithoutExt = normalizePath(existingParent ? `${existingParent}/${existingBasename}` : existingBasename);
						return {
							path: filePathWithoutExt,
							isLocal: true,
							filename: filename
						};
					}
					else {
						console.log(`[ATTACHMENT] Sizes don't match, will save as new file: ${targetFullName}`);
					}
				}
			}
			else {
				console.log(`[ATTACHMENT] Filename unchanged, original file doesn't exist`);
			}
		}

		// Save the file to disk
		await vault.createBinary(targetFilePath, response.arrayBuffer);
		
		// Return the file path without extension (for wiki links) and with extension (for markdown links)
		const { parent, basename: fileBasename } = parseFilePath(targetFilePath);
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
 * @param params - Parameters for formatting the link
 * @returns Formatted markdown link
 */
export function formatAttachmentLink(params: FormatAttachmentLinkParams): string {
	const { result, vault, app, sourceFilePath, caption = '', isEmbed = false } = params;
	
	// If not local (still a URL), use standard markdown syntax
	if (!result.isLocal) {
		if (isEmbed) {
			return `![${caption}](${result.path})`;
		}
		else {
			return `[${caption || 'Link'}](${result.path})`;
		}
	}
	
	// For wiki links, we need to include the file extension
	// Obsidian requires the extension to properly link to non-markdown files
	const [, ext] = splitext(result.filename || '');
	const pathWithExt = ext ? `${result.path}.${ext}` : result.path;
	
	// Get the target file from vault
	const targetFile = vault.getAbstractFileByPath(normalizePath(pathWithExt));
	if (!targetFile || !(targetFile instanceof TFile)) {
		// Fallback if file not found (shouldn't happen for local files)
		// Respect user's link format setting even in fallback
		const useWikiLinks = vault.getConfig('useWikiLinks') ?? true;
		const embedPrefix = isEmbed ? '!' : '';
		
		if (useWikiLinks) {
			// Wiki link format
			if (caption) {
				return `${embedPrefix}[[${pathWithExt}|${caption}]]`;
			}
			return `${embedPrefix}[[${pathWithExt}]]`;
		}
		else {
			// Markdown link format
			const displayText = caption || pathWithExt;
			if (isEmbed) {
				return `![${displayText}](${pathWithExt})`;
			}
			return `[${displayText}](${pathWithExt})`;
		}
	}
	
	// Use generateMarkdownLink to respect user's link format settings
	const link = app.fileManager.generateMarkdownLink(targetFile, sourceFilePath);
	
	// Add embed prefix if needed
	const embedPrefix = isEmbed ? '!' : '';
	
	// Add caption/display text if provided
	if (caption) {
		// For wiki links: [[path|caption]], for markdown links: [caption](path)
		if (link.startsWith('[[')) {
			// Wiki link: replace the closing ]] with |caption]]
			return `${embedPrefix}${link.slice(0, -2)}|${caption}]]`;
		}
		else {
			// Markdown link: replace the display text
			// Extract only the (path) part, not ](path)
			const pathPart = link.slice(link.indexOf('](') + 1); // Skip the ]
			return `${embedPrefix}[${caption}]${pathPart}`;
		}
	}
	
	return `${embedPrefix}${link}`;
}



