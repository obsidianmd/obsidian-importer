import { CachedMetadata, htmlToMarkdown, normalizePath, Notice, requestUrl, Setting, TFile, TFolder } from 'obsidian';
import { fsPromises, nodeBufferToArrayBuffer, NodePickedFile, parseFilePath, PickedFile, url as nodeUrl } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
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

	async import(progress: ProgressReporter): Promise<void> {
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

		for (let i = 0; i < files.length; i++) {
			progress.reportProgress(i, files.length);
			await this.processFile(progress, folder, files[i]);
		}
	}

	async processFile(progress: ProgressReporter, folder: TFolder, file: PickedFile) {
		try {
			const htmlContent = await file.readText();

			const dom = parseHTML(htmlContent);
			fixDocumentUrls(dom);

			// Find all the attachments and download them
			const baseUrl = file instanceof NodePickedFile ? nodeUrl.pathToFileURL(file.filepath) : undefined;
			const attachments = new Map<string, TFile | null>;
			const attachmentLookup = new Map<string, TFile>;
			for (let el of dom.findAll('img, audio, video')) {
				let src = el.getAttribute('src');
				if (!src) continue;

				try {
					const url = new URL(src.startsWith('//') ? `https:${src}` : src, baseUrl);

					let key = url.href;
					let attachmentFile = attachments.get(key);
					if (!attachments.has(key)) {
						attachmentFile = await this.downloadAttachment(folder, el, url);
						attachments.set(key, attachmentFile);
						if (attachmentFile) {
							attachmentLookup.set(attachmentFile.path, attachmentFile);
							progress.reportAttachmentSuccess(attachmentFile.name);
						}
						else {
							progress.reportSkipped(src);
						}
					}

					if (attachmentFile) {
						// Convert the embed into a vault absolute path
						el.setAttribute('src', attachmentFile.path.replace(/ /g, '%20'));

						// Convert `<audio>` and `<video>` into `<img>` so that htmlToMarkdown can properly parse it.
						if (!(el instanceof HTMLImageElement)) {
							el.replaceWith(createEl('img', { attr: { src: attachmentFile.path.replace(/ /g, '%20'), alt: el.getAttr('alt') } }));
						}
					}
				}
				catch (e) {
					progress.reportFailed(src, e);
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

			progress.reportNoteSuccess(file.fullpath);
		}
		catch (e) {
			progress.reportFailed(file.fullpath, e);
		}
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
