import { FrontMatterCache, moment, normalizePath, Notice, requestUrl, Setting, TFile } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { extractErrorMessage, sanitizeFileName, serializeFrontMatter, truncateText } from '../util';
import { ReflectExport, ReflectNote } from './reflect/models';
import { AttachmentInfo, convertDocument, ConvertOptions, EMBEDDABLE_EXTENSIONS, escapeMarkdownLinkText, getUrlPathname } from './reflect/convert';

const MAX_FILENAME_LENGTH = 200;
// One initial attempt plus one retry per entry here (signed export URLs are
// occasionally flaky during bulk imports; anything more is over-engineering).
const ATTACHMENT_RETRY_DELAYS_SECONDS = [2, 8];

class HttpStatusError extends Error {
	status: number;

	constructor(status: number) {
		super(`HTTP ${status}`);
		this.status = status;
	}
}

export class ReflectImporter extends FormatImporter {
	downloadAttachments: boolean;
	tagsFrontmatter: boolean;
	dateFrontmatter: boolean;
	titleFrontmatter: boolean;

	init() {
		// Initialize defaults in init() because FormatImporter calls init() from its constructor.
		this.downloadAttachments = false;
		this.tagsFrontmatter = true;
		this.dateFrontmatter = false;
		this.titleFrontmatter = false;

		this.addFileChooserSetting('Reflect (.json)', ['json']);
		this.addOutputLocationSetting('Reflect');

		new Setting(this.modal.contentEl)
			.setName('Import settings')
			.setHeading();

		new Setting(this.modal.contentEl)
			.setName('Download all attachments')
			.setDesc('If enabled, all attachments uploaded to Reflect will be downloaded to your attachments folder.')
			.addToggle(toggle => {
				toggle.setValue(this.downloadAttachments);
				toggle.onChange(async (value) => {
					this.downloadAttachments = value;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Add YAML tags')
			.setDesc('If enabled, tags from Reflect will be moved out of the note body and into a tags property.')
			.addToggle(toggle => {
				toggle.setValue(this.tagsFrontmatter);
				toggle.onChange(async (value) => {
					this.tagsFrontmatter = value;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Add YAML created/updated date')
			.setDesc('If enabled, notes will have the created and updated timestamps from Reflect added as properties.')
			.addToggle(toggle => {
				toggle.setValue(this.dateFrontmatter);
				toggle.onChange(async (value) => {
					this.dateFrontmatter = value;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Add YAML title')
			.setDesc('If enabled, notes will have the full title added as a property (regardless of illegal file name characters).')
			.addToggle(toggle => {
				toggle.setValue(this.titleFrontmatter);
				toggle.onChange(async (value) => {
					this.titleFrontmatter = value;
				});
			});
	}

	private getUserDNPFormat(): string {
		// @ts-expect-error : Internal Method
		const plugin = this.app.internalPlugins.getPluginById('daily-notes');
		if (!plugin?.instance) {
			return 'YYYY-MM-DD';
		}
		return plugin.instance.options?.format || 'YYYY-MM-DD';
	}

	private getNoteTitle(note: ReflectNote, userDNPFormat: string): string {
		if (note.daily_at) {
			const dailyTitle = moment(note.daily_at);
			if (dailyTitle.isValid()) {
				return dailyTitle.format(userDNPFormat);
			}
		}
		return truncateText(note.subject, MAX_FILENAME_LENGTH, '').trim() || 'Untitled';
	}

	private getAvailableNotePath(folderPath: string, title: string, claimedPaths: Set<string>): string {
		const baseName = sanitizeFileName(title);
		let suffix = 0;

		while (true) {
			const candidateName = suffix === 0 ? baseName : `${baseName} ${suffix}`;
			const candidatePath = normalizePath(`${folderPath}/${candidateName}.md`);
			const candidateKey = candidatePath.toLowerCase();

			const exists = this.vault.getAbstractFileByPath(candidatePath) || this.vault.getAbstractFileByPathInsensitive(candidatePath);
			if (!claimedPaths.has(candidateKey) && !exists) {
				claimedPaths.add(candidateKey);
				return candidatePath;
			}

			suffix++;
		}
	}

	private resolveAttachmentUrl(url: string): string | null {
		// Skip relative paths (orphaned refs from prior note app imports)
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			return null;
		}

		// Unwrap reflect.academy Next.js image proxy to fetch the underlying URL directly
		try {
			const parsed = new URL(url);
			if (parsed.hostname === 'reflect.academy' && parsed.pathname === '/_next/image') {
				const inner = parsed.searchParams.get('url');
				if (inner) return inner;
			}
		}
		catch { /* use original url */ }

		return url;
	}

	private getErrorMessage(error: unknown): string {
		const message = extractErrorMessage(error);
		if (message) return message;
		if (typeof error === 'string' && error.trim()) return error;
		return 'Unknown error';
	}

	private isNonImageContentType(contentType: string): boolean {
		if (!contentType) {
			// No header at all: nothing to judge by; let the download proceed.
			return false;
		}
		const normalized = contentType.toLowerCase();
		// Generic binary types are how some storage backends serve real images.
		return !normalized.startsWith('image/') && !normalized.includes('octet-stream');
	}

	private shouldRetryDownload(error: unknown): boolean {
		if (error instanceof HttpStatusError) {
			return error.status === 429 || error.status >= 500;
		}

		// fetch network failures surface as TypeError; requestUrl only as a message.
		if (error instanceof TypeError) {
			return true;
		}

		const message = this.getErrorMessage(error).toLowerCase();
		return message.includes('network')
			|| message.includes('timeout')
			|| message.includes('timed out')
			|| message.includes('fetch failed')
			|| message.includes('econnreset');
	}

	private parseReflectExport(content: string): ReflectExport {
		let parsed: unknown;

		try {
			parsed = JSON.parse(content);
		}
		catch (error) {
			throw new Error(`Invalid Reflect JSON: ${this.getErrorMessage(error)}`);
		}

		return this.validateReflectExport(parsed);
	}

	private validateReflectExport(data: unknown): ReflectExport {
		if (!data || typeof data !== 'object') {
			throw new Error('Invalid Reflect export: top-level object expected.');
		}

		const parsed = data as Partial<ReflectExport>;
		if (!Array.isArray(parsed.notes)) {
			throw new Error('Invalid Reflect export: "notes" must be an array.');
		}

		for (let i = 0; i < parsed.notes.length; i++) {
			const note = parsed.notes[i] as Partial<ReflectNote> | undefined;
			if (!note || typeof note !== 'object') {
				throw new Error(`Invalid Reflect export: note ${i + 1} is not an object.`);
			}
			if (typeof note.id !== 'string' || !note.id.trim()) {
				throw new Error(`Invalid Reflect export: note ${i + 1} is missing "id".`);
			}
			if (typeof note.subject !== 'string') {
				throw new Error(`Invalid Reflect export: note ${i + 1} is missing "subject".`);
			}
			if (typeof note.document_json !== 'string') {
				throw new Error(`Invalid Reflect export: note ${i + 1} is missing "document_json".`);
			}
			if (typeof note.created_at !== 'string' || typeof note.updated_at !== 'string') {
				throw new Error(`Invalid Reflect export: note ${i + 1} is missing timestamps.`);
			}
		}

		return parsed as ReflectExport;
	}

	private async fetchAttachmentData(url: string): Promise<{ data: ArrayBuffer, contentType: string }> {
		// Try fetch first, fall back to requestUrl (bypasses CORS in Electron)
		try {
			const response = await fetch(url, {
				mode: 'cors',
				referrerPolicy: 'no-referrer',
			});
			if (response.ok) {
				return {
					data: await response.arrayBuffer(),
					contentType: response.headers.get('content-type') || '',
				};
			}
		}
		catch { /* fall through to requestUrl */ }

		const response = await requestUrl({ url, throw: false });
		if (response.status !== 200) {
			throw new HttpStatusError(response.status);
		}
		return {
			data: response.arrayBuffer,
			contentType: response.headers['content-type'] || '',
		};
	}

	private async downloadAttachment(
		attachment: AttachmentInfo,
		sourcePath: string,
		claimedAttachmentPaths: string[],
		downloadedPathsByUrl: Map<string, string>,
		ctx: ImportContext,
	): Promise<string | null> {
		const resolvedUrl = this.resolveAttachmentUrl(attachment.url);
		if (!resolvedUrl) {
			return null;
		}

		const cachedPath = downloadedPathsByUrl.get(resolvedUrl);
		if (cachedPath) {
			return cachedPath;
		}

		let lastError: unknown;
		for (let attempt = 0; attempt <= ATTACHMENT_RETRY_DELAYS_SECONDS.length; attempt++) {
			if (ctx.isCancelled()) {
				return null;
			}
			try {
				const { data, contentType } = await this.fetchAttachmentData(resolvedUrl);

				// A dead asset behind Reflect's proxy can come back as an HTML
				// error page with HTTP 200; saving that as an image would corrupt
				// the vault silently. Fail instead so the remote-URL fallback and
				// the import log both reflect what happened.
				if (attachment.isImage && this.isNonImageContentType(contentType)) {
					throw new Error(`Expected image data but got '${contentType}'`);
				}

				// Note-provided filenames may carry characters that break vault
				// paths or wikilinks; fall back to a generated name. An unusable
				// name sanitizes to 'Untitled', which is equally worth replacing.
				let name = attachment.fileName ? sanitizeFileName(attachment.fileName) : '';
				if (!name || name === 'Untitled') {
					name = `reflect-attachment-${Date.now()}`;
				}
				if (!parseFilePath(name).extension) {
					name += this.getExtension(contentType, resolvedUrl, attachment.isImage);
				}

				// Respect vault attachment settings, including "Same folder as current file".
				const filePath = await this.getAvailablePathForAttachment(name, claimedAttachmentPaths, sourcePath);
				const parentPath = parseFilePath(filePath).parent;
				if (parentPath) {
					await this.createFolders(parentPath);
				}

				await this.vault.createBinary(filePath, data);
				claimedAttachmentPaths.push(filePath);
				downloadedPathsByUrl.set(resolvedUrl, filePath);
				ctx.reportAttachmentSuccess(parseFilePath(filePath).name);
				return filePath;
			}
			catch (error) {
				lastError = error;

				const delaySeconds = ATTACHMENT_RETRY_DELAYS_SECONDS[attempt];
				if (delaySeconds === undefined || !this.shouldRetryDownload(error)) {
					break;
				}
				await this.pause(delaySeconds, 'attachment download retry backoff', ctx);
			}
		}

		console.error('Reflect attachment download failed', {
			url: resolvedUrl,
			fileName: attachment.fileName,
			error: lastError,
		});
		ctx.reportFailed(attachment.fileName || attachment.url, this.getErrorMessage(lastError));
		return null;
	}

	private getExtension(mimeType: string, url: string, isImage: boolean): string {
		const map: Record<string, string> = {
			'image/png': '.png',
			'image/jpeg': '.jpg',
			'image/gif': '.gif',
			'image/webp': '.webp',
			'image/svg+xml': '.svg',
			'image/bmp': '.bmp',
			'image/avif': '.avif',
			'application/pdf': '.pdf',
			'audio/mpeg': '.mp3',
			'audio/mp4': '.m4a',
			'audio/x-m4a': '.m4a',
			'audio/wav': '.wav',
			'audio/x-wav': '.wav',
			'audio/webm': '.weba',
			'audio/ogg': '.ogg',
			'audio/opus': '.opus',
			'audio/flac': '.flac',
			'audio/3gpp': '.3gp',
			'video/mp4': '.mp4',
			'video/webm': '.webm',
			'video/ogg': '.ogv',
			'video/quicktime': '.mov',
			'video/x-matroska': '.mkv',
		};
		for (const [mime, ext] of Object.entries(map)) {
			if (mimeType.includes(mime)) return ext;
		}

		// Unknown content type: prefer an extension already present in the URL.
		const urlExtension = getUrlPathname(url).match(/\.[a-zA-Z0-9]{1,8}$/);
		if (urlExtension) {
			return urlExtension[0];
		}
		// Image nodes were historically saved as .png; generic files must not
		// be mislabeled as images.
		return isImage ? '.png' : '.bin';
	}

	async import(ctx: ImportContext) {
		// Read option values once so toggling mid-import has no effect.
		const shouldDownloadAttachments = this.downloadAttachments;
		const shouldAddTagsFrontmatter = this.tagsFrontmatter;
		const shouldAddDateFrontmatter = this.dateFrontmatter;
		const shouldAddTitleFrontmatter = this.titleFrontmatter;

		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		const userDNPFormat = this.getUserDNPFormat();

		for (let file of files) {
			if (ctx.isCancelled()) return;

			ctx.status('Reading ' + file.name);
			let data: ReflectExport;
			try {
				data = this.parseReflectExport(await file.readText());
			}
			catch (error) {
				console.error('Failed to parse Reflect export', { file: file.name, error });
				ctx.reportFailed(file.name, this.getErrorMessage(error));
				continue;
			}

			// Phase 1: Build ID -> output path and backlink target maps
			const idToSubject = new Map<string, string>();
			const idToOutputPath = new Map<string, string>();
			const claimedPaths = new Set<string>();
			const claimedAttachmentPaths: string[] = [];
			const downloadedPathsByUrl = new Map<string, string>();
			for (const note of data.notes) {
				const title = this.getNoteTitle(note, userDNPFormat);
				const outputPath = this.getAvailableNotePath(folder.path, title, claimedPaths);
				idToOutputPath.set(note.id, outputPath);
				idToSubject.set(note.id, parseFilePath(outputPath).basename);
			}

			const total = data.notes.length;
			for (let i = 0; i < data.notes.length; i++) {
				if (ctx.isCancelled()) return;
				const note = data.notes[i];
				const noteDisplayName = note.subject || note.id || 'Untitled';

				ctx.status('Importing ' + noteDisplayName);
				try {
					const convertOptions: ConvertOptions = {
						stripInlineTags: shouldAddTagsFrontmatter,
					};
					const result = convertDocument(
						note.document_json,
						idToSubject,
						note.subject,
						convertOptions,
					);
					const outputPath = idToOutputPath.get(note.id);
					if (!outputPath) {
						throw new Error(`Missing output path for note ${note.id}`);
					}
					const outputName = parseFilePath(outputPath).basename;

					// Build frontmatter
					let content = result.markdown;
					const frontMatter: FrontMatterCache = {
						id: note.id,
					};
					if (shouldAddTitleFrontmatter) {
						frontMatter['title'] = note.subject;
					}
					if (shouldAddTagsFrontmatter && result.tags.size > 0) {
						// Tags were already sanitized during conversion.
						frontMatter['tags'] = [...result.tags];
					}
					if (shouldAddDateFrontmatter) {
						frontMatter['created'] = note.created_at;
						frontMatter['updated'] = note.updated_at;
					}
					content = serializeFrontMatter(frontMatter) + content;

					// Download attachments sequentially to avoid request bursts.
					// Function replacers keep '$' sequences in paths and URLs literal.
					for (const attachment of result.attachments) {
						const localPath = shouldDownloadAttachments
							? await this.downloadAttachment(attachment, outputPath, claimedAttachmentPaths, downloadedPathsByUrl, ctx)
							: null;
						if (localPath) {
							// Embed only what Obsidian can render; judged from the file
							// actually saved, so mime/extension inference is respected.
							const embed = EMBEDDABLE_EXTENSIONS.test(localPath) ? '!' : '';
							content = content.replace(attachment.placeholder, () => `${embed}[[${localPath}]]`);
						}
						else if (attachment.isImage) {
							// External markdown embeds only render for images.
							content = content.replace(attachment.placeholder, () => `![](${attachment.url})`);
						}
						else {
							const label = escapeMarkdownLinkText(attachment.fileName || attachment.url);
							content = content.replace(attachment.placeholder, () => `[${label}](${attachment.url})`);
						}
					}

					let mdFile: TFile;
					const existing = this.vault.getAbstractFileByPath(outputPath);
					if (existing instanceof TFile) {
						await this.vault.modify(existing, content);
						mdFile = existing;
					}
					else {
						mdFile = await this.vault.create(outputPath, content);
					}

					// Preserve timestamps
					await this.vault.append(mdFile, '', {
						ctime: new Date(note.created_at).getTime(),
						mtime: new Date(note.updated_at).getTime(),
					});

					ctx.reportNoteSuccess(outputName);
				}
				catch (error) {
					console.error('Failed to import Reflect note', { noteId: note.id, error });
					ctx.reportFailed(noteDisplayName, this.getErrorMessage(error));
				}
				ctx.reportProgress(i + 1, total);
			}
		}
	}
}
