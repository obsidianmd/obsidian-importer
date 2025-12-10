/**
 * Attachment handling for Airtable
 */

import { requestUrl, normalizePath, TFile } from 'obsidian';
import type { Vault, App } from 'obsidian';
import { ImportContext } from '../../main';
import type { AirtableAttachment, AttachmentResult } from './types';
import { sanitizeFileName } from '../../util';

/**
 * Download an attachment from Airtable
 */
export async function downloadAttachment(
	attachment: AirtableAttachment,
	context: {
		ctx: ImportContext;
		vault: Vault;
		downloadAttachments: boolean;
		getAvailableAttachmentPath: (filename: string) => Promise<string>;
	}
): Promise<AttachmentResult> {
	const { ctx, vault, downloadAttachments, getAvailableAttachmentPath } = context;
	
	// If download is disabled, return URL
	if (!downloadAttachments) {
		return {
			path: attachment.url,
			isLocal: false,
			filename: attachment.filename,
		};
	}
	
	try {
		ctx.status(`Downloading attachment: ${attachment.filename}`);
		
		// Download the file
		const response = await requestUrl({
			url: attachment.url,
			method: 'GET',
			throw: false,
		});
		
		if (response.status !== 200) {
			console.warn(`Failed to download attachment: ${attachment.filename}`);
			return {
				path: attachment.url,
				isLocal: false,
				filename: attachment.filename,
			};
		}
		
		// Sanitize filename
		const sanitized = sanitizeFileName(attachment.filename);
		
		// Get available path (respects user's attachment folder settings)
		const targetPath = await getAvailableAttachmentPath(sanitized);
		
		// Create the file
		const normalizedPath = normalizePath(targetPath);
		await vault.createBinary(normalizedPath, response.arrayBuffer);
		
		return {
			path: normalizedPath,
			isLocal: true,
			filename: sanitized,
		};
	}
	catch (error) {
		console.error(`Failed to download attachment ${attachment.filename}:`, error);
		// Fall back to URL
		return {
			path: attachment.url,
			isLocal: false,
			filename: attachment.filename,
		};
	}
}

/**
 * Context for formatting attachment links
 */
interface FormatAttachmentLinkContext {
	result: AttachmentResult;
	app: App;
	vault: Vault;
	sourceFilePath: string;
	mimeType?: string;
}

/**
 * Format attachment as markdown link (for body content)
 * Uses generateMarkdownLink to respect user's link format settings
 * (wiki links vs markdown links, shortest/relative/absolute path)
 */
export function formatAttachmentLink(ctx: FormatAttachmentLinkContext): string {
	const { result, app, vault, sourceFilePath, mimeType } = ctx;
	
	if (!result.isLocal) {
		// External URL - use markdown format
		return `[${result.filename || 'Attachment'}](${result.path})`;
	}
	
	// Local file - get the actual file
	const file = vault.getAbstractFileByPath(result.path);
	
	if (file instanceof TFile) {
		// Determine if it's an image/video that should be embedded based on MIME type
		const isEmbeddable = mimeType ? (mimeType.startsWith('image/') || mimeType.startsWith('video/')) : false;
		
		// Use generateMarkdownLink to respect user's link format settings
		// This respects both "Use [[Wikilinks]]" and "New link format" settings
		const link = app.fileManager.generateMarkdownLink(file, sourceFilePath);
		
		// Add embed prefix for images/videos if not already present
		if (isEmbeddable && !link.startsWith('!')) {
			return '!' + link;
		}
		return link;
	}
	
	// Fallback
	return `[[${result.path}]]`;
}

/**
 * Format attachment for YAML frontmatter
 * YAML properties can only use wiki link syntax [[path]], not markdown links
 * Always uses wiki link format with full path including extension
 */
export function formatAttachmentForYAML(
	result: AttachmentResult
): string {
	if (!result.isLocal) {
		// External URL - return plain URL (no Markdown syntax in YAML)
		return result.path;
	}
	
	// Local file - use wiki link with full path
	return `[[${result.path}]]`;
}

/**
 * Process multiple attachments and return formatted markdown (for body content)
 * Uses generateMarkdownLink to respect user's link format settings
 */
export async function processAttachments(
	attachments: AirtableAttachment[],
	context: {
		ctx: ImportContext;
		currentFilePath: string;
		vault: Vault;
		app: App;
		downloadAttachments: boolean;
		getAvailableAttachmentPath: (filename: string) => Promise<string>;
		onAttachmentDownloaded?: () => void;
	}
): Promise<string[]> {
	const { ctx, currentFilePath, app, vault, downloadAttachments, getAvailableAttachmentPath, onAttachmentDownloaded } = context;
	const results: string[] = [];
	
	for (const attachment of attachments) {
		const result = await downloadAttachment(attachment, {
			ctx,
			vault,
			downloadAttachments,
			getAvailableAttachmentPath,
		});
		
		if (result.isLocal && onAttachmentDownloaded) {
			onAttachmentDownloaded();
		}
		
		// Format as link for body content using user's link format settings
		// Pass MIME type to determine if it should be embedded (images/videos)
		const link = formatAttachmentLink({
			result,
			app,
			vault,
			sourceFilePath: currentFilePath,
			mimeType: attachment.type,
		});
		
		results.push(link);
	}
	
	return results;
}

/**
 * Process multiple attachments for YAML frontmatter
 * Always uses wiki link format for YAML compatibility
 */
export async function processAttachmentsForYAML(
	attachments: AirtableAttachment[],
	context: {
		ctx: ImportContext;
		vault: Vault;
		downloadAttachments: boolean;
		getAvailableAttachmentPath: (filename: string) => Promise<string>;
		onAttachmentDownloaded?: () => void;
	}
): Promise<string[]> {
	const { ctx, vault, downloadAttachments, getAvailableAttachmentPath, onAttachmentDownloaded } = context;
	const results: string[] = [];
	
	for (const attachment of attachments) {
		const result = await downloadAttachment(attachment, {
			ctx,
			vault,
			downloadAttachments,
			getAvailableAttachmentPath,
		});
		
		if (result.isLocal && onAttachmentDownloaded) {
			onAttachmentDownloaded();
		}
		
		// Format for YAML (always wiki link)
		const formatted = formatAttachmentForYAML(result);
		results.push(formatted);
	}
	
	return results;
}

