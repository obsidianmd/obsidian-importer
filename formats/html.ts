import { CachedMetadata, htmlToMarkdown, normalizePath, Notice, Platform, requestUrl, Setting, TFile, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportResult } from '../main';
import { fsPromises, NodePickedFile, PickedFile } from '../filesystem';
import { pathToFilename, PromiseExecutor, sanitizeFileName, splitFilename } from '../util';
import { extension } from './util/mime';

const nodeUrl: typeof import("node:url") = Platform.isDesktopApp ? window.require("node:url") : null;

export class HtmlImporter extends FormatImporter {
	attachments: Record<string, ReturnType<typeof this.downloadAttachment>> = {};
	requestHTTPExecutor = new PromiseExecutor(5);
	writeAttachmentExecutor = new PromiseExecutor(1);

	attachmentSizeLimit: number;
	minimumImageSize: number;

	init() {
		this.addFileChooserSetting('HTML (.htm .html)', ['htm', 'html']);
		this.addAttatchmentSizeLimit(0);
		this.addMinimumImageSize(65); // 65 so that 64×64 are excluded
		this.addOutputLocationSetting('HTML');
	}

	addAttatchmentSizeLimit(defaultInMB: number) {
		this.attachmentSizeLimit = defaultInMB * 10 ** 6;
		new Setting(this.modal.contentEl)
			.setName("Attachment size limit (MB)")
			.setDesc("Set 0 to disable.")
			.addText(text => text
				.then(({ inputEl }) => {
					inputEl.type = "number";
					inputEl.step = "0.1";
				})
				.setValue(defaultInMB.toString())
				.onChange(value => {
					const num = ["+", "-"].includes(value) ? 0 : Number(value);
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
			.setName("Minimum image size (px)")
			.setDesc("Set 0 to disable.")
			.addText(text => text
				.then(({ inputEl }) => inputEl.type = "number")
				.setValue(defaultInPx.toString())
				.onChange(value => {
					const num = ["+", "-"].includes(value) ? 0 : Number(value);
					if (!Number.isInteger(num) || num < 0) {
						text.setValue(this.minimumImageSize.toString());
						return;
					}
					this.minimumImageSize = num;
				}))
	}

	async import() {
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

		const result: ImportResult = {
			total: 0,
			skipped: [],
			failed: [],
		};
		await Promise.all(files.map(file => this.processFile(result, folder, file)));
		this.showResult(result);
	}

	async processFile(result: ImportResult, folder: TFolder, file: PickedFile) {
		let mdFile: TFile | null = null;
		try {
			const htmlContent = await file.readText();
			mdFile = await this.saveAsMarkdownFile(folder, file.basename, "");
			const mdContent = htmlToMarkdown(htmlContent);
			if (!mdContent) {
				return;
			}

			const dom = new DOMParser().parseFromString(htmlContent, "text/html");
			const pathURL = file instanceof NodePickedFile ? nodeUrl.pathToFileURL(file.filepath) : undefined;
			const downloads = await Promise.allSettled(
				Array.from(dom.querySelectorAll<HTMLAudioElement | HTMLImageElement | HTMLVideoElement>("audio, img, video"))
					.map(async element => {
						type TagNames = keyof {
							[K in keyof HTMLElementTagNameMap as HTMLElementTagNameMap[K] extends typeof element ? K : never]: never
						};
						let src = "";
						try {
							src = element.getAttribute("src"); // `element.src` does not give the raw `src` string
							return [
								decodeURIComponent(src),
								await this.downloadAttachmentCached(
									mdFile,
									element.tagName.toLowerCase() as TagNames,
									new URL(src.startsWith("//") ? `https:${src}` : src, pathURL),
								),
							] as const;
						} catch (e) {
							console.error(e);
							throw src;
						}
					})
			);
			result.total += downloads.length;
			result.failed = result.failed.concat(downloads
				.filter((dl): dl is typeof dl & { status: "rejected" } => dl.status === "rejected")
				.map(({ reason }) => reason));
			result.skipped = result.skipped.concat(downloads
				.filter((dl): dl is typeof dl & { status: "fulfilled" } => dl.status === "fulfilled" && !dl.value[1])
				.map(({ value: [src] }) => src));

			const attachments = Object.fromEntries(downloads
				.filter((dl): dl is typeof dl & { status: "fulfilled" } => dl.status === "fulfilled" && Boolean(dl.value[1]))
				.map(({ value }) => value));
			if (Object.keys(attachments).length > 0) {
				const cache0 = new Promise<CachedMetadata>(resolve => {
					const ref = this.app.metadataCache.on("changed", (file, _1, cache) => {
						if (file.path === mdFile.path) {
							try {
								resolve(cache);
							} finally {
								this.app.metadataCache.offref(ref);
							}
						}
					});
				});
				await this.app.vault.process(mdFile, data =>
					`${data}${mdContent.replace(
						new RegExp(Object.keys(attachments)
							.sort(({ length: left }, { length: right }) => right - left)
							.map(escapeRegExp)
							.join("|"), "gu"),
						encodeURI,
					)}`);
				const cache = await cache0;
				await this.app.vault.process(mdFile, data => {
					const replacements = Object.fromEntries((cache.embeds ?? [])
						.map(embed => {
							const { [embed.link]: attachment } = attachments;
							if (!attachment) {
								return null;
							}
							return [embed.original, this.app.fileManager.generateMarkdownLink(attachment, mdFile.path, "", embed.displayText)] as const;
						})
						.filter(entry => entry));
					if (Object.keys(replacements).length > 0) {
						return data.replace(
							new RegExp(Object.keys(replacements)
								.sort(({ length: left }, { length: right }) => right - left)
								.map(escapeRegExp)
								.join("|"), "gu"),
							link => replacements[link],
						);
					}
					return data;
				});
			} else {
				await this.app.vault.process(mdFile, data => `${data}${mdContent}`);
			}
		} catch (e) {
			console.error(e);
			result.failed.push(file.toString());
			if (mdFile) {
				try {
					await this.app.vault.delete(mdFile);
				} catch (e) {
					console.error(e);
				}
			}
		}
	}

	downloadAttachmentCached(mdFile: TFile, type: TypedResponse["type"], url: URL) {
		return this.attachments[url.href] ??= this.downloadAttachment(mdFile, type, url);
	}

	async downloadAttachment(mdFile: TFile, type: TypedResponse["type"], url: URL) {
		let response;
		switch (url.protocol) {
			case "file:":
				response = await this.requestFile(type, url);
				break;
			case "https:":
			case "http:":
				response = await this.requestHTTP(type, url);
				break;
			default:
				throw new Error(url.href);
		}
		if (!await this.filterAttachment(response)) {
			return null;
		}
		const { data, extension } = response;
		let filename = getURLFilename(url);
		if (extension) {
			if (splitFilename(filename).extension !== extension) {
				filename += `.${extension}`;
			}
		} else {
			filename += `.noext.${{
				"audio": "mp3",
				"img": "bmp",
				"video": "mp4",
			}[type]}`;
		}
		return await this.writeAttachment(mdFile, filename, data);
	}

	async requestFile(type: TypedResponse["type"], url: URL) {
		return {
			type,
			data: (await fsPromises.readFile(nodeUrl.fileURLToPath(url.href))).buffer,
			extension: splitFilename(getURLFilename(url)).extension,
		};
	}

	requestHTTP(type: TypedResponse["type"], url: URL) {
		return this.requestHTTPExecutor.run(async () => {
			url = new URL(url.href);
			let response;
			try {
				url.protocol = "https:";
				response = await requestURL(url);
			} catch (e) {
				try {
					url.protocol = "http:";
					response = await requestURL(url);
				} catch (e2) {
					console.error(e2);
					throw e;
				}
			}
			return {
				type,
				data: response.data,
				extension: extension(response.mime) || splitFilename(getURLFilename(url)).extension,
			};
		});
	}

	writeAttachment(mdFile: TFile, filename: string, data: ArrayBufferLike) {
		return this.writeAttachmentExecutor.run(async () => {
			const { basename, extension } = splitFilename(sanitizeFileName(filename));
			// @ts-ignore
			const path: string = await this.app.vault.getAvailablePathForAttachments(basename, extension, mdFile);
			return await this.app.vault.createBinary(path, data);
		});
	}

	async filterAttachment(response: TypedResponse) {
		const { data } = response;
		return this.filterAttachmentSize(data) && await this.filterImageSize(response);
	}

	filterAttachmentSize(data: ArrayBufferLike) {
		const { byteLength } = data;
		return !this.attachmentSizeLimit || byteLength <= this.attachmentSizeLimit;
	}

	async filterImageSize(response: TypedResponse) {
		const { data, type } = response;
		if (!this.minimumImageSize || type !== "img") {
			return true;
		}
		let size;
		try {
			size = await imageSize(new Blob([data]));
		} catch {
			return true;
		}
		const { height, width } = size;
		return width >= this.minimumImageSize && height >= this.minimumImageSize;
	}
}

interface TypedResponse {
	type: "audio" | "img" | "video";
	data: ArrayBufferLike;
	extension: string;
}

function escapeRegExp(str: string) {
	return str.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function getURLFilename(url: URL) {
	return pathToFilename(normalizePath(decodeURIComponent(url.pathname)));
}

async function requestURL(url: URL) {
	try {
		const response = await fetch(url, {
			mode: "cors",
			referrerPolicy: "no-referrer",
		});
		if (!response.ok) {
			throw new Error(response.statusText);
		}
		return {
			data: await response.arrayBuffer(),
			mime: response.headers.get("Content-Type") ?? "",
		};
	} catch {
		const response = await requestUrl(url.href);
		return {
			data: response.arrayBuffer,
			mime: response.headers["Content-Type"] ?? "",
		};
	}
}

async function imageSize(data: Blob) {
	const image = new Image();
	const url = URL.createObjectURL(data);
	try {
		return await new Promise<{ height: number, width: number }>((resolve, reject) => {
			image.addEventListener("error", ({ error }) => reject(error), { once: true, passive: true });
			image.addEventListener(
				"load",
				() => resolve({ height: image.naturalHeight, width: image.naturalWidth }),
				{ once: true, passive: true },
			);
			image.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}
