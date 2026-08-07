import { CachedMetadata, normalizePath, Notice, parseLinktext, requestUrl, TFile, TFolder } from 'obsidian';
import {
	fsPromises,
	nodeBufferToArrayBuffer,
	NodePickedFile,
	parseFilePath,
	PickedFile,
	url as nodeUrl,
} from '../filesystem';
import { FormatImporter } from '../format-importer';
import { convertHtmlDocument } from './html/convert';
import { ImportContext } from '../import-context';
import { extensionForMime } from '../mime';
import { stringToUtf8 } from '../util';

export class HtmlImporter extends FormatImporter {
	interruption = 'pause' as const;

	attachmentSizeLimit: number;
	minimumImageSize: number;

	init() {
		this.addFileChooserSetting('HTML', ['htm', 'html'], true);
		this.addAttachmentSizeLimit(0);
		this.addMinimumImageSize(65); // 65 so that 64×64 are excluded
		this.addOutputLocationSetting('HTML import');
	}

	addAttachmentSizeLimit(defaultInMB: number) {
		this.attachmentSizeLimit = defaultInMB * 10 ** 6;
		this.addSetting()
			?.setName('Attachment size limit (MB)')
			.setDesc('Set 0 to disable.')
			.addText(text => text
				.then(({ inputEl }) => {
					inputEl.type = 'number';
					inputEl.step = '0.1';
				})
				.setValue(defaultInMB.toString())
				.onChange(value => {
					const num = ['+', '-'].includes(value) ? 0 : Number(value);
					if (Number.isNaN(num) || num < 0) {
						text.setValue((this.attachmentSizeLimit / 10 ** 6).toString());
						return;
					}
					this.attachmentSizeLimit = num * 10 ** 6;
				}));
	}

	addMinimumImageSize(defaultInPx: number) {
		this.minimumImageSize = defaultInPx;
		this.addSetting()
			?.setName('Minimum image size (px)')
			.setDesc('Set 0 to disable.')
			.addText(text => text
				.then(({ inputEl }) => inputEl.type = 'number')
				.setValue(defaultInPx.toString())
				.onChange(value => {
					const num = ['+', '-'].includes(value) ? 0 : Number(value);
					if (!Number.isInteger(num) || num < 0) {
						text.setValue(this.minimumImageSize.toString());
						return;
					}
					this.minimumImageSize = num;
				}));
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		const fileLookup = new Map<string, { file: PickedFile, tFile: TFile }>;

		ctx.reportProgress(0, files.length);
		for (let i = 0; i < files.length; i++) {
			if (await ctx.shouldStop()) return;

			const file = files[i];
			const tFile = await this.processFile(ctx, folder, file);
			if (tFile) {
				fileLookup.set(
					file instanceof NodePickedFile
						? nodeUrl.pathToFileURL(file.filepath).href
						: file.name,
					{ file, tFile });
			}

			ctx.reportProgress(i+1, files.length);
		}

		const { metadataCache } = this.app;

		let resolveUpdatesCompletePromise: () => void;
		const updatesCompletePromise = new Promise<void>((resolve) => {
			resolveUpdatesCompletePromise = resolve;
		});

		// @ts-ignore
		metadataCache.onCleanCache(async () => {
			// This function must call resolveUpdatesCompletePromise() before returning.
			for (const [fileKey, { file, tFile }] of fileLookup) {
				if (await ctx.shouldStop()) break;

				try {
					// Attempt to parse links using MetadataCache
					let mdContent = await this.app.vault.cachedRead(tFile);

					// @ts-ignore
					const cache = metadataCache.computeMetadataAsync
						// @ts-ignore
						? await metadataCache.computeMetadataAsync(stringToUtf8(mdContent)) as CachedMetadata
						: metadataCache.getFileCache(tFile);
					if (!cache) continue;

					// Gather changes to make to the document
					const changes = [];
					if (cache.links) {
						for (const { link, position, displayText } of cache.links) {
							const { path, subpath } = parseLinktext(link);
							let linkKey: string;
							if (nodeUrl) {
								const url = new URL(encodeURI(path), fileKey);
								url.hash = '';
								url.search = '';
								linkKey = decodeURIComponent(url.href);
							}
							else {
								linkKey = parseFilePath(path.replace(/#/gu, '%23')).name;
							}
							const linkFile = fileLookup.get(linkKey);
							if (linkFile) {
								const newLink = this.app.fileManager.generateMarkdownLink(linkFile.tFile, tFile.path, subpath, displayText);
								changes.push({ from: position.start.offset, to: position.end.offset, text: newLink });
							}
						}
					}

					// Apply changes from last to first
					changes.sort((a, b) => b.from - a.from);
					for (const change of changes) {
						mdContent = mdContent.substring(0, change.from) + change.text + mdContent.substring(change.to);
					}

					await this.vault.modify(tFile, mdContent);
				}
				catch (e) {
					ctx.reportFailed(file.fullpath, e);
				}
			}

			resolveUpdatesCompletePromise();
		});

		await updatesCompletePromise;
	}

	async processFile(ctx: ImportContext, folder: TFolder, file: PickedFile) {
		ctx.status('Processing ' + file.name);
		try {
			const htmlContent = await file.readText();

			// Where the document lives, so its relative references resolve, and
			// the directory nothing outside of may be read.
			const baseUrl = file instanceof NodePickedFile ? nodeUrl.pathToFileURL(file.filepath) : undefined;
			const allowedBaseDirUrl = baseUrl ? new URL('./', baseUrl.href).href : undefined;

			const attachmentLookup = new Map<string, TFile>;

			const { markdown, attachments } = await convertHtmlDocument(htmlContent, {
				baseUrl,
				isCancelled: () => ctx.isCancelled(),
				resolveAttachment: async (url, el) => {
					ctx.status('Downloading attachment for ' + file.name);
					const attachmentFile = await this.downloadAttachment(folder, el, url, allowedBaseDirUrl);
					if (!attachmentFile) return null;

					attachmentLookup.set(attachmentFile.path, attachmentFile);
					return { path: attachmentFile.path, name: attachmentFile.name };
				},
				onAttachment: attachment => ctx.reportAttachmentSuccess(attachment.name),
				onSkipped: src => ctx.reportSkipped(src),
				onFailed: (src, e) => ctx.reportFailed(src, e),
			});

			let mdContent = markdown;
			let mdFile = await this.saveAsMarkdownFile(folder, file.basename, mdContent);

			// Because `htmlToMarkdown` always gets us markdown links, we'll want to convert them into wikilinks, or relative links depending on the user's preference.
			if (attachments.size > 0) {
				// Attempt to parse links using MetadataCache
				let { metadataCache } = this.app;
				let cache: CachedMetadata;
				// @ts-ignore
				if (metadataCache.computeMetadataAsync) {
					// @ts-ignore
					cache = await metadataCache.computeMetadataAsync(stringToUtf8(mdContent)) as CachedMetadata;
				}
				else {
					cache = await new Promise<CachedMetadata>(resolve => {
						let cache = metadataCache.getFileCache(mdFile);
						if (cache) return resolve(cache);
						const ref = metadataCache.on('changed', (file, content, cache) => {
							if (file === mdFile) {
								metadataCache.offref(ref);
								resolve(cache);
							}
						});
					});
				}

				// Gather changes to make to the document
				let changes = [];
				if (cache.embeds) {
					for (let { link, position } of cache.embeds) {
						if (attachmentLookup.has(link)) {
							let newLink = this.app.fileManager.generateMarkdownLink(attachmentLookup.get(link)!, mdFile.path);
							changes.push({ from: position.start.offset, to: position.end.offset, text: newLink });
						}
					}
				}

				// Apply changes from last to first
				changes.sort((a, b) => b.from - a.from);
				for (let change of changes) {
					mdContent = mdContent.substring(0, change.from) + change.text + mdContent.substring(change.to);
				}

				await this.vault.modify(mdFile, mdContent);
			}

			ctx.reportNoteSuccess(file.fullpath);
			return mdFile;
		}
		catch (e) {
			ctx.reportFailed(file.fullpath, e);
		}
		return null;
	}

	async downloadAttachment(folder: TFolder, el: HTMLElement, url: URL, allowedBaseDirUrl?: string) {
		let basename = '';
		let extension = '';
		let data: ArrayBuffer;
		switch (url.protocol) {
			case 'file:': {
				// Validate the resolved URL is within the allowed base directory
				// The URL constructor already normalizes paths (resolves .. sequences)
				if (allowedBaseDirUrl && !url.href.startsWith(allowedBaseDirUrl)) {
					throw new Error(`File path is outside the allowed directory`);
				}
				let filepath = nodeUrl.fileURLToPath(url.href);
				({ basename, extension } = parseFilePath(filepath));
				data = nodeBufferToArrayBuffer(await fsPromises.readFile(filepath));
				break;
			}
			case 'https:':
			case 'http:': {
				let response = await requestURL(url);
				let pathInfo = parseURL(url);
				basename = pathInfo.basename;
				data = response.data;
				extension = extensionForMime(response.mime) || pathInfo.extension;
				break;
			}
			default:
				throw new Error(url.href);
		}

		if (!this.filterAttachmentSize(data)) return null;
		if (el.instanceOf(HTMLImageElement) && !await this.filterImageSize(data)) return null;

		if (!extension) {
			if (el.instanceOf(HTMLImageElement)) {
				extension = 'png';
			}
			else if (el.instanceOf(HTMLAudioElement)) {
				extension = 'mp3';
			}
			else if (el.instanceOf(HTMLVideoElement)) {
				extension = 'mp4';
			}
			else {
				return null;
			}
		}

		let attachmentFolder = await this.createFolders(normalizePath(folder.path + '/Attachments'));

		const path: string = this.vault.getAvailablePath(attachmentFolder.getParentPrefix() + basename, extension);

		return await this.vault.createBinary(path, data);
	}


	filterAttachmentSize(data: ArrayBuffer) {
		const { byteLength } = data;
		return !this.attachmentSizeLimit || byteLength <= this.attachmentSizeLimit;
	}

	async filterImageSize(data: ArrayBuffer) {
		if (!this.minimumImageSize) {
			return true;
		}
		let size;
		try {
			size = await getImageSize(data);
		}
		catch {
			return true;
		}
		const { height, width } = size;
		return width >= this.minimumImageSize && height >= this.minimumImageSize;
	}
}

function parseURL(url: URL) {
	return parseFilePath(normalizePath(decodeURIComponent(url.pathname)));
}

async function requestURL(url: URL): Promise<{ data: ArrayBuffer, mime: string }> {
	// requestUrl rather than fetch: it is not bound by CORS, so it reaches
	// assets a cross-origin fetch would be refused. This used to try fetch
	// first and fall back to here anyway, which only added a failed request.
	const response = await requestUrl(url.href);
	return {
		data: response.arrayBuffer,
		mime: headerValue(response.headers, 'content-type') ?? '',
	};
}

/** Header lookup that does not assume how the response cased the name. */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const wanted = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === wanted) return headers[key];
	}
	return undefined;
}

async function getImageSize(data: ArrayBuffer): Promise<{ height: number, width: number }> {
	const image = new Image();
	const url = URL.createObjectURL(new Blob([data]));
	try {
		return await new Promise((resolve, reject) => {
			image.addEventListener('error', ({ error }) => reject(error instanceof Error ? error : new Error('Could not read image')), { once: true, passive: true });
			image.addEventListener('load', () => resolve({ height: image.naturalHeight, width: image.naturalWidth }),
				{ once: true, passive: true });
			image.src = url;
		});
	}
	finally {
		URL.revokeObjectURL(url);
	}
}
