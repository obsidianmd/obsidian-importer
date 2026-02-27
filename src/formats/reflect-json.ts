import { moment, normalizePath, Notice, requestUrl, Setting, TFile } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { sanitizeFileName, serializeFrontMatter } from '../util';
import { sanitizeTag } from './keep/util';
import { ReflectExport, ReflectNote } from './reflect/models';
import { convertDocument, ConvertOptions } from './reflect/convert';

const MAX_FILENAME_LENGTH = 200;

function truncateTitle(title: string): string {
	if (title.length <= MAX_FILENAME_LENGTH) return title;
	return title.substring(0, MAX_FILENAME_LENGTH).trim();
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
					this.downloadAttachments = value === true;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Add YAML tags')
			.setDesc('If enabled, notes will have tags from Reflect added as properties.')
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
			return moment(note.daily_at).format(userDNPFormat);
		}
		return truncateTitle(note.subject);
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

	private resolveImageUrl(url: string): string | null {
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

	private async fetchImageData(url: string): Promise<{ data: ArrayBuffer, contentType: string }> {
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
			throw new Error(`HTTP ${response.status}`);
		}
		return {
			data: response.arrayBuffer,
			contentType: response.headers['content-type'] || '',
		};
	}

	private async downloadImage(
		url: string,
		fileName: string,
		sourcePath: string,
		claimedAttachmentPaths: string[],
		downloadedImagePathsByUrl: Map<string, string>,
		ctx: ImportContext,
	): Promise<string | null> {
		const resolvedUrl = this.resolveImageUrl(url);
		if (!resolvedUrl) {
			return null;
		}

		const cachedPath = downloadedImagePathsByUrl.get(resolvedUrl);
		if (cachedPath) {
			return cachedPath;
		}

		try {
			const { data, contentType } = await this.fetchImageData(resolvedUrl);

			// Determine filename
			let name = fileName;
			if (!name) {
				const ext = this.getExtensionFromMimeType(contentType);
				name = `reflect-image-${Date.now()}${ext}`;
			}

			// Respect vault attachment settings, including "Same folder as current file".
			const filePath = await this.getAvailablePathForAttachment(name, claimedAttachmentPaths, sourcePath);
			claimedAttachmentPaths.push(filePath);
			const parentPath = parseFilePath(filePath).parent;
			if (parentPath) {
				await this.createFolders(parentPath);
			}

			await this.vault.createBinary(filePath, data);
			downloadedImagePathsByUrl.set(resolvedUrl, filePath);
			ctx.reportAttachmentSuccess(parseFilePath(filePath).name);
			return filePath;
		}
		catch (e) {
			ctx.reportFailed(fileName || url, e);
			return null;
		}
	}

	private getExtensionFromMimeType(mimeType: string): string {
		const map: Record<string, string> = {
			'image/png': '.png',
			'image/jpeg': '.jpg',
			'image/gif': '.gif',
			'image/webp': '.webp',
			'image/svg+xml': '.svg',
			'image/bmp': '.bmp',
		};
		for (const [mime, ext] of Object.entries(map)) {
			if (mimeType.includes(mime)) return ext;
		}
		return '.png';
	}

	async import(ctx: ImportContext) {
		// Snapshot option values for this run so they can't drift mid-import.
		const shouldDownloadAttachments = this.downloadAttachments === true;

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
			const data = JSON.parse(await file.readText()) as ReflectExport;

			// Phase 1: Build ID → output path and backlink target maps
			const idToSubject = new Map<string, string>();
			const idToOutputPath = new Map<string, string>();
			const claimedPaths = new Set<string>();
			const claimedAttachmentPaths: string[] = [];
			const downloadedImagePathsByUrl = new Map<string, string>();
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

				ctx.status('Importing ' + note.subject);
				try {
					const convertOptions: ConvertOptions = {
						stripInlineTags: this.tagsFrontmatter,
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
					const frontMatter: Record<string, any> = {};
					if (this.titleFrontmatter) {
						frontMatter['title'] = note.subject;
					}
					if (this.tagsFrontmatter && result.tags.size > 0) {
						frontMatter['tags'] = [...result.tags].map(t => sanitizeTag(t));
					}
					if (this.dateFrontmatter) {
						frontMatter['created'] = note.created_at;
						frontMatter['updated'] = note.updated_at;
					}
					if (Object.keys(frontMatter).length > 0) {
						content = serializeFrontMatter(frontMatter) + result.markdown;
					}

					// Download images and replace placeholders
					if (shouldDownloadAttachments && result.images.length > 0) {
						for (const image of result.images) {
							const localPath = await this.downloadImage(
								image.url,
								image.fileName,
								outputPath,
								claimedAttachmentPaths,
								downloadedImagePathsByUrl,
								ctx,
							);
							if (localPath) {
								content = content.replace(image.placeholder, `![[${localPath}]]`);
							}
							else {
								content = content.replace(image.placeholder, `![](${image.url})`);
							}
						}
					}
					else if (result.images.length > 0) {
						// Not downloading: replace placeholders with original URLs
						for (const image of result.images) {
							content = content.replace(image.placeholder, `![](${image.url})`);
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
				catch (e) {
					ctx.reportFailed(note.subject, e);
				}
				ctx.reportProgress(i + 1, total);
			}
		}
	}
}
