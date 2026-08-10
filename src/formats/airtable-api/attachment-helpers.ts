/**
 * Attachment handling for Airtable
 */

import { requestUrl, normalizePath, TFile } from 'obsidian';
import type { Vault, App } from 'obsidian';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import type { AirtableAttachment, AttachmentPlacement, AttachmentResult } from './types';
import { sanitizeFileName } from '../../util';

/**
 * Download an attachment from Airtable
 */
async function downloadAttachment(
	attachment: AirtableAttachment,
	context: {
		ctx: ImportContext;
		vault: Vault;
		downloadAttachments: boolean;
		placeAttachment: (filename: string, size: number | undefined) => Promise<AttachmentPlacement>;
		/** Give a name back when the download it was chosen for does not arrive. */
		releasePath: (path: string) => void;
	}
): Promise<AttachmentResult> {
	const { ctx, vault, downloadAttachments, placeAttachment, releasePath } = context;

	// Every failure path leaves the note pointing at Airtable's own URL, so the
	// attachment is still reachable even though it is not in the vault
	const remote: AttachmentResult = {
		path: attachment.url,
		isLocal: false,
		filename: attachment.filename,
		mimeType: attachment.type,
	};

	if (!downloadAttachments) {
		return remote;
	}

	try {
		const sanitized = sanitizeFileName(attachment.filename);

		// Where it goes is settled first, because the answer may be a file the
		// vault already holds - and then there is nothing to download.
		const { path, reuse } = await placeAttachment(sanitized, attachment.size);
		const local: AttachmentResult = { path: normalizePath(path), isLocal: true, filename: sanitized };

		if (reuse) {
			ctx.reportSkipped(sanitized, i18n.reason.alreadyInVault());
			return { ...local, reused: true };
		}

		ctx.status(i18n.importer.airtableApi.statusDownloadingAttachment({ name: attachment.filename }));

		const response = await requestUrl({
			url: attachment.url,
			method: 'GET',
			throw: false,
		});

		if (response.status !== 200) {
			console.warn(`Failed to download attachment: ${attachment.filename}`);
			releasePath(local.path);
			return remote;
		}

		await vault.createBinary(local.path, response.arrayBuffer);

		return local;
	}
	catch (error) {
		console.error(`Failed to download attachment ${attachment.filename}:`, error);
		return remote;
	}
}

/**
 * Format attachment as markdown link (for body content)
 * Uses generateMarkdownLink to respect user's link format settings
 * (wiki links vs markdown links, shortest/relative/absolute path)
 */
function formatAttachmentLink(context: {
	result: AttachmentResult;
	app: App;
	vault: Vault;
	sourceFilePath: string;
}): string {
	const { result, app, vault, sourceFilePath } = context;

	if (!result.isLocal) {
		// External URL - use markdown format
		return `[${result.filename || 'Attachment'}](${result.path})`;
	}

	// Local file - get the actual file
	const file = vault.getAbstractFileByPath(result.path);

	if (file instanceof TFile) {
		// Use generateMarkdownLink to respect user's link format settings
		// This respects both "Use [[Wikilinks]]" and "New link format" settings
		const link = app.fileManager.generateMarkdownLink(file, sourceFilePath);

		// Images and video embed rather than link
		const mimeType = result.mimeType;
		const isEmbeddable = !!mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'));
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
function formatAttachmentForYAML(result: AttachmentResult): string {
	// External URL - return plain URL (no Markdown syntax in YAML)
	return result.isLocal ? `[[${result.path}]]` : result.path;
}

/**
 * Download a field's attachments once.
 *
 * A single attachment field can be rendered into both the note body and a YAML
 * property. Downloading is done here exactly once so both renderings reference
 * the same vault file — downloading per rendering would write a second copy
 * under a deduplicated name and double-count ctx.attachments.
 */
export async function downloadAttachmentList(
	attachments: AirtableAttachment[],
	context: {
		ctx: ImportContext;
		vault: Vault;
		downloadAttachments: boolean;
		placeAttachment: (filename: string, size: number | undefined) => Promise<AttachmentPlacement>;
		releasePath: (path: string) => void;
	}
): Promise<AttachmentResult[]> {
	const { ctx, vault, downloadAttachments, placeAttachment, releasePath } = context;
	const results: AttachmentResult[] = [];

	for (const attachment of attachments) {
		const result = await downloadAttachment(attachment, {
			ctx,
			vault,
			downloadAttachments,
			placeAttachment,
			releasePath,
		});

		// A file the vault already held was reported as passed over; counting it
		// as an import as well would count it twice.
		if (result.isLocal && !result.reused) {
			ctx.reportAttachmentSuccess(result.filename ?? attachment.filename);
		}

		results.push(result);
	}

	return results;
}

/**
 * Format already-downloaded attachments as markdown for body content
 * Uses generateMarkdownLink to respect user's link format settings
 */
export function formatAttachmentsForBody(
	results: AttachmentResult[],
	context: {
		currentFilePath: string;
		vault: Vault;
		app: App;
	}
): string[] {
	const { currentFilePath, app, vault } = context;

	return results.map(result => formatAttachmentLink({
		result,
		app,
		vault,
		sourceFilePath: currentFilePath,
	}));
}

/**
 * Format already-downloaded attachments for YAML frontmatter
 * Always uses wiki link format for YAML compatibility
 */
export function formatAttachmentsForYAML(results: AttachmentResult[]): string[] {
	return results.map(formatAttachmentForYAML);
}

