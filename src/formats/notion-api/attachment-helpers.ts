/**
 * Attachment helper functions for Notion API importer
 * Handles downloading and processing attachments (images, files, videos, PDFs)
 */

import { App, DataWriteOptions, normalizePath, requestUrl, TFile, Vault } from 'obsidian';
import { ImportContext } from '../../import-context';
import { RichTextItemResponse } from '@notionhq/client';
import { sanitizeFileName } from '../../util';
import { splitext, parseFilePath } from '../../filesystem';
import { extensionForMime } from '../../mime';
import { NotionAttachment, AttachmentResult, BlockConversionContext, FormatAttachmentLinkParams } from './types';

/**
 * What a download produced, whichever way it was fetched: over HTTP, or
 * decoded out of the URL itself.
 */
interface DownloadedAttachment {
	arrayBuffer: ArrayBuffer;
	contentType?: string;
}

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

	// A data URL carries the file in the URL, so there is no path to take a
	// name from: what looks like one is the head of the base64 payload.
	const isDataUrl = attachment.url.toLowerCase().startsWith('data:');

	// Extract filename early for error reporting
	// Priority: attachment.name > URL extraction > currentPageTitle > 'attachment'
	let filename = attachment.name || (isDataUrl ? '' : extractFilenameFromUrl(attachment.url)) || currentPageTitle || 'attachment';
	filename = sanitizeFileName(filename);

	try {
		// Download the file first to get Content-Type header
		ctx.status(`Downloading attachment: ${filename}...`);
		let downloaded: DownloadedAttachment;

		if (isDataUrl) {
			// requestUrl speaks http(s) only, so decoding is the download.
			downloaded = decodeDataUrl(attachment.url);
		}
		else {
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

			downloaded = {
				arrayBuffer: response.arrayBuffer,
				contentType: response.headers['content-type'] || response.headers['Content-Type'],
			};
		}

		// Check if filename has an extension, if not, infer from Content-Type
		const [basename, ext] = splitext(filename);
		if (!ext && downloaded.contentType) {
			const extension = extensionForMime(downloaded.contentType);
			if (extension) {
				filename = `${basename}.${extension}`;
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


		// Link the copy already there rather than writing a second one
		if (incrementalImport) {
			const existingFile = attachmentAlreadyImported(vault, targetFilePath, filename, downloaded.arrayBuffer.byteLength);

			if (existingFile) {
				ctx.reportSkipped(`Attachment: ${filename}`, 'already exists with same size (incremental import)');

				const { parent: existingParent, basename: existingBasename } = parseFilePath(existingFile.path);
				const filePathWithoutExt = normalizePath(existingParent ? `${existingParent}/${existingBasename}` : existingBasename);
				return {
					path: filePathWithoutExt,
					isLocal: true,
					filename: filename
				};
			}
		}

		// Save the file to disk
		const options: DataWriteOptions = {};
		if (attachment.created_time) options.ctime = new Date(attachment.created_time).getTime();
		if (attachment.last_edited_time) options.mtime = new Date(attachment.last_edited_time).getTime();
		await vault.createBinary(targetFilePath, downloaded.arrayBuffer, options);

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
 * The attachment already in the vault that this one would be a second copy of.
 *
 * An attachment carries no id, so what says two are the same is the name and
 * the size. The name having been taken is what getAvailableAttachmentPath
 * reports, by handing back a different one: asked for "photo.jpg" it returns
 * "photo 1.jpg" only when "photo.jpg" is there.
 *
 * The size is compared after the attachment has been fetched, so what this
 * saves is a second copy in the vault rather than the download. Knowing the
 * size without fetching would take a request of its own, and a server that
 * answers it - neither of which this asks for.
 */
function attachmentAlreadyImported(vault: Vault, targetFilePath: string, filename: string, size: number): TFile | null {
	const { parent, basename } = parseFilePath(targetFilePath);
	// Read the extension off filename rather than the target: the target's has
	// been through the Content-Type inference, and filename is what was asked
	// for. A name that came back unchanged means nothing was in the way.
	const [, extension] = splitext(filename);
	if (basename + (extension ? `.${extension}` : '') === filename) return null;

	const existingFile = vault.getAbstractFileByPathInsensitive(normalizePath(`${parent}/${filename}`));

	return existingFile instanceof TFile && existingFile.stat.size === size ? existingFile : null;
}

/**
 * Decode a `data:` URL into the bytes it carries.
 *
 * Follows the order the URL spec reads one in: percent-decode the body, then
 * base64-decode it if the media type said so.
 */
function decodeDataUrl(url: string): DownloadedAttachment {
	const match = /^data:([^,]*),([\s\S]*)$/i.exec(url);
	if (!match) throw new Error('Malformed data URL');

	const [, mediaType, body] = match;
	const parameters = mediaType.split(';').map(part => part.trim()).filter(Boolean);
	// The media type is only there if it looks like one; `data:;base64,…` and
	// `data:,…` are both legal and leave the extension to be guessed elsewhere.
	const contentType = parameters[0]?.includes('/') ? parameters[0] : undefined;
	const isBase64 = parameters.some(parameter => parameter.toLowerCase() === 'base64');

	const percentDecoded = decodePercentEncoding(body);
	const bytes = isBase64 ? decodeBase64(percentDecoded) : percentDecoded;

	// A fresh buffer, so what reaches createBinary is an ArrayBuffer of exactly
	// these bytes rather than a view into a larger one.
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return { arrayBuffer: copy.buffer, contentType };
}

function decodePercentEncoding(body: string): Uint8Array {
	const bytes: number[] = [];

	for (let i = 0; i < body.length; i++) {
		if (body[i] === '%' && i + 2 < body.length) {
			const byte = Number.parseInt(body.substring(i + 1, i + 3), 16);
			if (!Number.isNaN(byte)) {
				bytes.push(byte);
				i += 2;
				continue;
			}
		}

		bytes.push(body.charCodeAt(i));
	}

	return new Uint8Array(bytes);
}

function decodeBase64(bytes: Uint8Array): Uint8Array {
	// The base64 alphabet is ASCII, so the percent-decoded bytes read back as
	// the string atob wants. Whitespace is dropped: a data URL long enough to
	// have been wrapped across lines still has to decode.
	let encoded = '';
	for (const byte of bytes) encoded += String.fromCharCode(byte);

	const binary = atob(encoded.replace(/\s/g, ''));
	const decoded = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) decoded[i] = binary.charCodeAt(i);
	return decoded;
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
	catch {
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
		vault: Vault;
		app: App;
		ctx: ImportContext;
		currentFilePath?: string;
		currentFolderPath?: string;
		downloadExternalAttachments?: boolean;
		incrementalImport?: boolean;
		onAttachmentDownloaded?: (filename: string) => void;
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
			context.onAttachmentDownloaded(result.filename ?? '');
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

