import { CachedMetadata, htmlToMarkdown, normalizePath, Notice, parseLinktext, requestUrl, Setting, TFile, TFolder } from 'obsidian';
import {
	fsPromises,
	nodeBufferToArrayBuffer,
	NodePickedFile,
	parseFilePath,
	PickedFile,
	url as nodeUrl,
} from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { extensionForMime } from '../mime';
import { parseHTML, stringToUtf8 } from '../util';

export class HtmlImporter extends FormatImporter {
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
		new Setting(this.modal.contentEl)
			.setName('Attachment size limit (MB)')
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
		new Setting(this.modal.contentEl)
			.setName('Minimum image size (px)')
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
			if (ctx.isCancelled()) return;

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
				if (ctx.isCancelled()) break;

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

			const dom = parseHTML(htmlContent);
			fixDocumentUrls(dom);

			// Find all the attachments and download them
			const baseUrl = file instanceof NodePickedFile ? nodeUrl.pathToFileURL(file.filepath) : undefined;
			const attachments = new Map<string, TFile | null>;
			const attachmentLookup = new Map<string, TFile>;
			for (let el of dom.findAll('img, audio, video')) {
				if (ctx.isCancelled()) return;

				let src = el.getAttribute('src');
				if (!src) continue;

				try {
					const url = new URL(src.startsWith('//') ? `https:${src}` : src, baseUrl);

					let key = url.href;
					let attachmentFile = attachments.get(key);
					if (!attachments.has(key)) {
						ctx.status('Downloading attachment for ' + file.name);
						attachmentFile = await this.downloadAttachment(folder, el, url);
						attachments.set(key, attachmentFile);
						if (attachmentFile) {
							attachmentLookup.set(attachmentFile.path, attachmentFile);
							ctx.reportAttachmentSuccess(attachmentFile.name);
						}
						else {
							ctx.reportSkipped(src);
						}
					}

					if (attachmentFile) {
						// Convert the embed into a vault absolute path
						el.setAttribute('src', attachmentFile.path.replace(/ /g, '%20'));

						// Convert `<audio>` and `<video>` into `<img>` so that htmlToMarkdown can properly parse it.
						if (!(el instanceof HTMLImageElement)) {
							el.replaceWith(createEl('img', {
								attr: {
									src: attachmentFile.path.replace(/ /g, '%20'),
									alt: el.getAttr('alt'),
								},
							}));
						}
					}
				}
				catch (e) {
					ctx.reportFailed(src, e);
				}
			}

			let mdContent = htmlToMarkdown(dom);
			let mdFile = await this.saveAsMarkdownFile(folder, file.basename, mdContent);

			// Because `htmlToMarkdown` always gets us markdown links, we'll want to convert them into wikilinks, or relative links depending on the user's preference.
			if (!Object.isEmpty(attachments)) {
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

	async downloadAttachment(folder: TFolder, el: HTMLElement, url: URL) {
		let basename = '';
		let extension = '';
		let data: ArrayBuffer;
		switch (url.protocol) {
			case 'file:':
				let filepath = nodeUrl.fileURLToPath(url.href);
				({ basename, extension } = parseFilePath(filepath));
				data = nodeBufferToArrayBuffer(await fsPromises.readFile(filepath));
				break;
			case 'https:':
			case 'http:':
				let response = await requestURL(url);
				let pathInfo = parseURL(url);
				basename = pathInfo.basename;
				data = response.data;
				extension = extensionForMime(response.mime) || pathInfo.extension;
				break;
			default:
				throw new Error(url.href);
		}

		if (!this.filterAttachmentSize(data)) return null;
		if (el instanceof HTMLImageElement && !await this.filterImageSize(data)) return null;

		if (!extension) {
			if (el instanceof HTMLImageElement) {
				extension = 'png';
			}
			else if (el instanceof HTMLAudioElement) {
				extension = 'mp3';
			}
			else if (el instanceof HTMLVideoElement) {
				extension = 'mp4';
			}
			else {
				return null;
			}
		}

		let attachmentFolder = await this.createFolders(normalizePath(folder.path + '/Attachments'));

		// @ts-ignore
		const path: string = await this.vault.getAvailablePath(attachmentFolder.getParentPrefix() + basename, extension);

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

function fixElementRef(element: Element, attribute: string) {
	const value = element.getAttribute(attribute);
	if (value !== null) {
		element.setAttribute(attribute, value.replace(/ /gu, '%20'));
	}
}

// Fix any links that happen to have spaces in them, since markdown links/embeds do not allow that.
function fixDocumentUrls(el: Element) {
	el.findAll('a').forEach(element => fixElementRef(element, 'href'));
	el.findAll('audio, img, video').forEach(element => fixElementRef(element, 'src'));
}

function parseURL(url: URL) {
	return parseFilePath(normalizePath(decodeURIComponent(url.pathname)));
}

async function requestURL(url: URL): Promise<{ data: ArrayBuffer, mime: string }> {
	try {
		const response = await fetch(url, {
			mode: 'cors',
			referrerPolicy: 'no-referrer',
		});
		if (response.ok) {
			return {
				data: await response.arrayBuffer(),
				mime: response.headers.get('Content-Type') ?? '',
			};
		}
	}
	catch { }

	const response = await requestUrl(url.href);
	return {
		data: response.arrayBuffer,
		mime: response.headers['Content-Type'] ?? '',
	};
}

async function getImageSize(data: ArrayBuffer): Promise<{ height: number, width: number }> {
	const image = new Image();
	const url = URL.createObjectURL(new Blob([data]));
	try {
		return await new Promise((resolve, reject) => {
			image.addEventListener('error', ({ error }) => reject(error), { once: true, passive: true });
			image.addEventListener('load', () => resolve({ height: image.naturalHeight, width: image.naturalWidth }),
				{ once: true, passive: true });
			image.src = url;
		});
	}
	finally {
		URL.revokeObjectURL(url);
	}
}
