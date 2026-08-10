/**
 * Attachment helper functions for Notion API importer
 * Handles downloading and processing attachments (images, files, videos, PDFs)
 */

import { App, DataWriteOptions, normalizePath, RequestUrlResponse, requestUrl, TFile, Vault } from 'obsidian';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import { RichTextItemResponse } from '@notionhq/client';
import { availableFileName, sanitizeFileName } from '../../util';
import { splitext, parseFilePath } from '../../filesystem';
import { extensionForMime } from '../../mime';
import { backOffBeforeRetry } from './utils';
import { NotionAttachment, AttachmentResult, BlockConversionContext, FormatAttachmentLinkParams } from './types';

interface DownloadedAttachment {
	arrayBuffer: ArrayBuffer;
	contentType?: string;
}

const MAX_ATTACHMENT_RETRIES = 3;

// Bound recovery when the vault index and filesystem keep disagreeing.
const MAX_NAME_COLLISIONS = 20;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

// Notion storage uses 202 while preparing a file; external servers may use it as a refusal.
function worthAnotherTry(status: number, notionHosted: boolean): boolean {
	if (status === 202) return notionHosted;

	return RETRYABLE_STATUSES.has(status);
}

// Retry connection failures, not persistent DNS or certificate errors.
const RETRYABLE_NETWORK_ERRORS = /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_ABORTED|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_SOCKET_NOT_CONNECTED/;

async function requestAttachment(
	attachment: NotionAttachment,
	filename: string,
	ctx: ImportContext
): Promise<RequestUrlResponse> {
	const notionHosted = attachment.type === 'file';

	for (let attempt = 0; ; attempt++) {
		const lastTry = attempt >= MAX_ATTACHMENT_RETRIES;
		let answer: RequestUrlResponse | null = null;
		let thrown: unknown;
		let failure: string;

		try {
			answer = await requestUrl({ url: attachment.url, method: 'GET', throw: false });
			if (lastTry || !worthAnotherTry(answer.status, notionHosted)) return answer;

			failure = `HTTP ${answer.status}`;
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (lastTry || !RETRYABLE_NETWORK_ERRORS.test(message)) throw error;

			thrown = error;
			failure = message;
		}

		const waitFor = Math.pow(2, attempt);
		const waiting = i18n.importer.notionApi.statusRetryingAttachment({
			name: filename,
			failure,
			seconds: waitFor,
			attempt: attempt + 1,
			total: MAX_ATTACHMENT_RETRIES,
		});

		// Preserve the response or error that prompted the retry.
		if (!await backOffBeforeRetry(ctx, waitFor, waiting)) {
			if (answer) return answer;
			throw thrown;
		}
	}
}

/** Preserves external links; failed Notion-hosted files remain import failures. */
function reportUndownloadable(
	attachment: NotionAttachment,
	filename: string,
	reason: string,
	ctx: ImportContext
): AttachmentResult {
	const isLink = attachment.type === 'external' && !attachment.url.toLowerCase().startsWith('data:');

	const label = i18n.importer.notionApi.labelAttachment({ name: filename });

	if (isLink) ctx.reportSkipped(label, i18n.importer.notionApi.reasonKeptLink({ reason, url: attachment.url }));
	else ctx.reportFailed(label, reason);

	return {
		path: attachment.url,
		isLocal: false
	};
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
	const shouldDownload = !context.forChildrenOnly
		&& (attachment.type === 'file' || (attachment.type === 'external' && downloadExternalAttachments));

	if (!shouldDownload) {
		// Return original URL for external files when download is disabled
		return {
			path: attachment.url,
			isLocal: false
		};
	}

	const isDataUrl = attachment.url.toLowerCase().startsWith('data:');

	// Extract filename early for error reporting
	// Priority: attachment.name > URL extraction > currentPageTitle > 'attachment'
	let filename = attachment.name || (isDataUrl ? '' : extractFilenameFromUrl(attachment.url)) || currentPageTitle || 'attachment';
	filename = sanitizeFileName(filename);

	try {
		ctx.status(i18n.importer.notionApi.statusDownloadingAttachment({ name: filename }));

		const probe = context.rangeProbe ??= { answered: true };

		if (incrementalImport && !isDataUrl && probe.answered) {
			const probed = await probeAttachmentSize(attachment.url, probe);

			if (probed) {
				const probedName = withInferredExtension(filename, probed.contentType);
				const existingFile = attachmentAlreadyImported(
					vault, await resolveTargetPath(context, probedName), probedName, probed.size
				);

				if (existingFile) return skipExisting(ctx, existingFile, probedName);
			}
		}

		let downloaded: DownloadedAttachment;

		if (isDataUrl) {
			downloaded = decodeDataUrl(attachment.url);
		}
		else {
			const response = await requestAttachment(attachment, filename, ctx);

			if (response.status !== 200) {
				console.error(`Failed to download attachment "${filename}": ${response.status}`);
				return reportUndownloadable(
					attachment,
					filename,
					i18n.importer.notionApi.reasonHttpStatus({ status: response.status }),
					ctx
				);
			}

			downloaded = {
				arrayBuffer: response.arrayBuffer,
				contentType: response.headers['content-type'] || response.headers['Content-Type'],
			};
		}

		filename = withInferredExtension(filename, downloaded.contentType);
		let targetFilePath = await resolveTargetPath(context, filename);

		if (incrementalImport) {
			const existingFile = attachmentAlreadyImported(vault, targetFilePath, filename, downloaded.arrayBuffer.byteLength);

			if (existingFile) return skipExisting(ctx, existingFile, filename);
		}

		// Save the file to disk
		const options: DataWriteOptions = {};
		if (attachment.created_time) options.ctime = new Date(attachment.created_time).getTime();
		if (attachment.last_edited_time) options.mtime = new Date(attachment.last_edited_time).getTime();
		const { parent: attachmentFolder, name: firstName } = parseFilePath(targetFilePath);
		const inFolder = (name: string) => normalizePath(attachmentFolder ? `${attachmentFolder}/${name}` : name);
		const attemptedPaths = new Set<string>();

		for (;;) {
			attemptedPaths.add(targetFilePath);

			try {
				await vault.createBinary(targetFilePath, downloaded.arrayBuffer, options);
				break;
			}
			catch (error) {
				// The path can be claimed between selection and write.
				const occupied = vault.getAbstractFileByPathInsensitive(targetFilePath);
				if (!(occupied instanceof TFile) && !isFileExistsError(error)) throw error;

				if (attemptedPaths.size > MAX_NAME_COLLISIONS || await ctx.shouldStop()) throw error;

				if (incrementalImport && occupied instanceof TFile && occupied.stat.size === downloaded.arrayBuffer.byteLength) {
					return skipExisting(ctx, occupied, filename);
				}

				targetFilePath = await resolveTargetPath(context, filename);
				// Avoid paths already attempted when the vault returns the same name.
				if (attemptedPaths.has(targetFilePath)) {
					targetFilePath = inFolder(availableFileName(firstName, name => attemptedPaths.has(inFolder(name))));
				}
			}
		}

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
		return reportUndownloadable(attachment, filename, errorMsg, ctx);
	}
}

function isFileExistsError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\bEEXIST\b|\bFile already exists\b/i.test(message);
}

async function probeAttachmentSize(url: string, probe: { answered: boolean }): Promise<{ size: number, contentType?: string } | null> {
	// Presigned S3 URLs may reject HEAD, so request only the first byte.
	const response = await requestUrl({ url, method: 'GET', headers: { Range: 'bytes=0-0' }, throw: false });

	if (response.status !== 206) {
		// A 200 response ignored the range and downloaded the whole file.
		probe.answered = false;
		return null;
	}

	const contentRange = response.headers['content-range'] ?? response.headers['Content-Range'];
	const total = /\/(\d+)\s*$/.exec(contentRange ?? '')?.[1];
	if (!total) {
		probe.answered = false;
		return null;
	}

	return {
		size: Number(total),
		contentType: response.headers['content-type'] ?? response.headers['Content-Type'],
	};
}

function withInferredExtension(filename: string, contentType: string | undefined): string {
	const [basename, extension] = splitext(filename);
	if (extension || !contentType) return filename;

	const inferred = extensionForMime(contentType);
	return inferred ? `${basename}.${inferred}` : filename;
}

async function resolveTargetPath(context: BlockConversionContext, filename: string): Promise<string> {
	if (context.getAvailableAttachmentPath) return await context.getAvailableAttachmentPath(filename);

	const sourceFilePath = context.currentFilePath || context.currentFolderPath || '';
	return sourceFilePath ? normalizePath(`${sourceFilePath}/${filename}`) : filename;
}

function skipExisting(ctx: ImportContext, file: TFile, filename: string): AttachmentResult {
	ctx.reportSkipped(
		i18n.importer.notionApi.labelAttachment({ name: filename }),
		i18n.importer.notionApi.reasonAttachmentExists({ path: file.path })
	);

	return linkToExisting(file, filename);
}

function linkToExisting(file: TFile, filename: string): AttachmentResult {
	const { parent, basename } = parseFilePath(file.path);

	return {
		path: normalizePath(parent ? `${parent}/${basename}` : basename),
		isLocal: true,
		filename,
	};
}

function attachmentAlreadyImported(vault: Vault, targetFilePath: string, filename: string, size: number): TFile | null {
	const { parent, basename } = parseFilePath(targetFilePath);
	const [, extension] = splitext(filename);
	// An unchanged target name means there was no collision to inspect.
	if (basename + (extension ? `.${extension}` : '') === filename) return null;

	const existingFile = vault.getAbstractFileByPathInsensitive(normalizePath(`${parent}/${filename}`));

	return existingFile instanceof TFile && existingFile.stat.size === size ? existingFile : null;
}

function decodeDataUrl(url: string): DownloadedAttachment {
	const match = /^data:([^,]*),([\s\S]*)$/i.exec(url);
	if (!match) throw new Error('Malformed data URL');

	const [, mediaType, body] = match;
	const parameters = mediaType.split(';').map(part => part.trim()).filter(Boolean);
	const contentType = parameters[0]?.includes('/') ? parameters[0] : undefined;
	const isBase64 = parameters.some(parameter => parameter.toLowerCase() === 'base64');

	const percentDecoded = decodePercentEncoding(body);
	const bytes = isBase64 ? decodeBase64(percentDecoded) : percentDecoded;

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
