/**
 * Attachment helper functions for Notion API importer
 * Handles downloading and processing attachments (images, files, videos, PDFs)
 */

import { DataWriteOptions, normalizePath, requestUrl, TFile } from 'obsidian';
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

		// Get available path for attachment using the provided function or fallback
		let targetFilePath: string;
		if (context.getAvailableAttachmentPath) {
			// Use the FormatImporter's method which respects Obsidian's settings
			targetFilePath = await context.getAvailableAttachmentPath(filename);
		}
		else {
			// Fallback: construct path manually (shouldn't happen in normal usage)
			const sourceFilePath = context.currentFilePath || context.currentFolderPath || '';
			targetFilePath = sourceFilePath
				? normalizePath(`${sourceFilePath}/${filename}`)
				: filename;
		}

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
		const options: DataWriteOptions = {};
		if (attachment.created_time) options.ctime = new Date(attachment.created_time).getTime();
		if (attachment.last_edited_time) options.mtime = new Date(attachment.last_edited_time).getTime();
		await vault.createBinary(targetFilePath, response.arrayBuffer, options);

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
			created_time: block.created_time,
			last_edited_time: block.last_edited_time,
		};
	}
	else if (attachmentData.type === 'external' && attachmentData.external) {
		return {
			type: 'external',
			url: attachmentData.external.url,
			name: attachmentData.name,
			created_time: block.created_time,
			last_edited_time: block.last_edited_time,
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
	const { result, vault, app, sourceFilePath, caption = '', isEmbed = false, forceWikiLink = false } = params;

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
		// Respect user's link format setting, unless forceWikiLink is true
		const useWikiLinks = forceWikiLink || (vault.getConfig('useWikiLinks') ?? true);
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

	// Use generateMarkdownLink to respect user's link format settings, unless forceWikiLink is true
	let link: string;
	if (forceWikiLink) {
		// Force wiki link format for YAML compatibility
		link = `[[${pathWithExt}]]`;
	}
	else {
		// Use user's preference
		link = app.fileManager.generateMarkdownLink(targetFile, sourceFilePath);
	}

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

/**
 * Download an attachment and format it as an Obsidian link
 * This is a helper function that combines downloadAttachment and formatAttachmentLink
 * with progress tracking and error handling
 * 
 * @param attachment - Attachment information
 * @param context - Block conversion context or similar context with vault, app, etc.
 * @param options - Additional options for formatting
 * @returns Formatted Obsidian link, or fallback markdown link on error
 */
export async function downloadAndFormatAttachment(
	attachment: NotionAttachment,
	context: {
		vault: any;
		app: any;
		ctx: any;
		currentFilePath?: string;
		currentFolderPath?: string;
		downloadExternalAttachments?: boolean;
		incrementalImport?: boolean;
		onAttachmentDownloaded?: () => void;
		getAvailableAttachmentPath?: (filename: string) => Promise<string>;
	},
	options?: {
		caption?: string;
		isEmbed?: boolean;
		fallbackText?: string;
		forceWikiLink?: boolean;
	}
): Promise<string> {
	const { caption = '', isEmbed = false, fallbackText = 'file', forceWikiLink = false } = options || {};

	try {
		// Download the attachment
		const result = await downloadAttachment(attachment, context as any);

		// Report progress if attachment was downloaded
		if (result.isLocal && context.onAttachmentDownloaded) {
			context.onAttachmentDownloaded();
		}

		// Format link according to user's vault settings
		const sourceFilePath = context.currentFilePath || context.currentFolderPath || '';
		return formatAttachmentLink({
			result,
			vault: context.vault,
			app: context.app,
			sourceFilePath,
			caption,
			isEmbed,
			forceWikiLink
		});
	}
	catch (error) {
		console.error('Failed to download and format attachment:', error);

		// If download failed, return a fallback markdown link with the original URL
		const linkText = caption || attachment.name || fallbackText;
		const linkPrefix = isEmbed ? '!' : '';
		return `${linkPrefix}[${linkText}](${attachment.url})`;
	}
}

