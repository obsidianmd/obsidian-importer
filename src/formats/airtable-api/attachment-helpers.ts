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
		currentFolderPath: string;
		currentFilePath: string;
		vault: Vault;
		app: App;
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
		
		// Return path without extension for wiki links
		const pathWithoutExt = targetPath.replace(/\.[^/.]+$/, '');
		
		return {
			path: pathWithoutExt,
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
 * Format attachment as markdown link (for body content)
 */
export function formatAttachmentLink(
	result: AttachmentResult,
	app: App,
	vault: Vault,
	sourceFilePath: string,
	useWikiLinks: boolean = true
): string {
	if (!result.isLocal) {
		// External URL - use markdown format
		return `[${result.filename || 'Attachment'}](${result.path})`;
	}
	
	// Local file - get the actual file
	const ext = result.filename ? result.filename.substring(result.filename.lastIndexOf('.')) : '';
	const fullPath = result.path + ext;
	const file = vault.getAbstractFileByPath(normalizePath(fullPath));
	
	if (file instanceof TFile) {
		// Determine if it's an image/video that should be embedded
		const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'];
		const videoExts = ['mp4', 'webm', 'ogv', 'mov', 'mkv'];
		const isEmbeddable = [...imageExts, ...videoExts].some(e => fullPath.endsWith('.' + e));
		
		if (useWikiLinks) {
			// Use wiki link format
			const prefix = isEmbeddable ? '!' : '';
			return `${prefix}[[${result.path}]]`;
		}
		else {
			// Use markdown link format
			const link = app.fileManager.generateMarkdownLink(file, sourceFilePath);
			if (isEmbeddable && !link.startsWith('!')) {
				return '!' + link;
			}
			return link;
		}
	}
	
	// Fallback
	return `[[${result.path}]]`;
}

/**
 * Format attachment for YAML frontmatter (no Markdown syntax)
 */
export function formatAttachmentForYAML(
	result: AttachmentResult,
	vault: Vault
): string {
	if (!result.isLocal) {
		// External URL - return plain URL (no Markdown syntax in YAML)
		return result.path;
	}
	
	// Local file - use wiki link syntax with full path including extension
	const ext = result.filename ? result.filename.substring(result.filename.lastIndexOf('.')) : '';
	const fullPath = result.path + ext;
	
	// Return wiki link with full path (including extension)
	return `[[${fullPath}]]`;
}

/**
 * Process multiple attachments and return formatted markdown (for body content)
 */
export async function processAttachments(
	attachments: AirtableAttachment[],
	context: {
		ctx: ImportContext;
		currentFolderPath: string;
		currentFilePath: string;
		vault: Vault;
		app: App;
		downloadAttachments: boolean;
		getAvailableAttachmentPath: (filename: string) => Promise<string>;
		onAttachmentDownloaded?: () => void;
	}
): Promise<string[]> {
	const { app, vault, onAttachmentDownloaded } = context;
	const results: string[] = [];
	
	for (const attachment of attachments) {
		const result = await downloadAttachment(attachment, context);
		
		if (result.isLocal && onAttachmentDownloaded) {
			onAttachmentDownloaded();
		}
		
		// Format as link for body content
		const link = formatAttachmentLink(
			result,
			app,
			vault,
			context.currentFilePath,
			true // Use wiki links by default
		);
		
		results.push(link);
	}
	
	return results;
}

/**
 * Process multiple attachments for YAML frontmatter (no Markdown syntax)
 */
export async function processAttachmentsForYAML(
	attachments: AirtableAttachment[],
	context: {
		ctx: ImportContext;
		currentFolderPath: string;
		currentFilePath: string;
		vault: Vault;
		app: App;
		downloadAttachments: boolean;
		getAvailableAttachmentPath: (filename: string) => Promise<string>;
		onAttachmentDownloaded?: () => void;
	}
): Promise<string[]> {
	const { vault, onAttachmentDownloaded } = context;
	const results: string[] = [];
	
	for (const attachment of attachments) {
		const result = await downloadAttachment(attachment, context);
		
		if (result.isLocal && onAttachmentDownloaded) {
			onAttachmentDownloaded();
		}
		
		// Format for YAML (no Markdown syntax)
		const formatted = formatAttachmentForYAML(result, vault);
		results.push(formatted);
	}
	
	return results;
}

