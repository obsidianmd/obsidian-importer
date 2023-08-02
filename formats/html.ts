import { htmlToMarkdown, normalizePath, Notice, Platform, requestUrl, Setting, TFile, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportResult } from '../main';
import { fsPromises, NodePickedFile, PickedFile } from '../filesystem';
import { pathToFilename, sanitizeFileName, splitFilename } from '../util';
import { extension, mime } from "./utils/mime";

const fileType: typeof import("file-type") = Platform.isDesktopApp ? require("file-type") : null;
const nodeUrl: typeof import("node:url") = Platform.isDesktopApp ? window.require("node:url") : null;

export class HtmlImporter extends FormatImporter {
	attachments: Record<string, ReturnType<typeof this.downloadAttachment>> = {};

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
		if (!(file instanceof NodePickedFile)) {
			result.skipped.push(file.name);
			return;
		}
		let mdFile: TFile | null = null;
		try {
			let mdContent = htmlToMarkdown(await file.readText());
			const pathURL = nodeUrl.pathToFileURL(file.filepath);
			mdFile = await this.saveAsMarkdownFile(folder, file.basename, "");

			const ast = [];
			let read = 0;
			let next = 0;
			do {
				next = mdContent.indexOf("!", read);
				if (next === -1) {
					next = mdContent.length;
				}
				const link = parseMarkdownLink(mdContent.slice(next), false);
				if (link) {
					ast.push(mdContent.slice(read, next), {
						link,
						text: mdContent.slice(next, next + link.read),
					});
					next += link.read;
				} else {
					next += "!".length;
					ast.push(mdContent.slice(read, next));
				}
				read = next;
			} while (read < mdContent.length)
			const transformedAST = await Promise.all(ast
				.map(async ast => {
					if (typeof ast === "string") {
						return { text: ast };
					}
					try {
						let { link, link: { path: linkpath, display }, text } = ast;
						const correctedPath = linkpath.startsWith("//") ? `https:${linkpath}` : linkpath;
						let url;
						try {
							url = new URL(correctedPath);
						} catch (e) {
							if (!(e instanceof TypeError)) {
								throw e;
							}
							url = new URL(normalizePath(correctedPath)
								.split("/")
								.map(encodeURIComponent)
								.join("/"), pathURL);
						}
						const attachment = await this.downloadAttachmentCached(mdFile, url);
						if (attachment instanceof TFile) {
							text = this.app.fileManager.generateMarkdownLink(attachment, mdFile.path, "", display);
						}
						return { text, attachment, link } as const;
					} catch (e) {
						console.error(e);
						return { text: ast.text };
					}
				}));
			result.total += transformedAST
				.filter(({ link }) => link)
				.length;
			result.failed = result.failed.concat(transformedAST
				.filter(({ attachment }) => attachment === "failed")
				.map(({ link: { path } }) => path));
			result.skipped = result.skipped.concat(transformedAST
				.filter(({ attachment }) => attachment === "skipped")
				.map(({ link: { path } }) => path));

			mdContent = transformedAST.map(({ text }) => text).join("");
			await this.app.vault.modify(mdFile, mdContent);
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

	downloadAttachmentCached(mdFile: TFile, url: URL) {
		return this.attachments[url.href] ??= this.downloadAttachment(mdFile, url);
	}

	async downloadAttachment(mdFile: TFile, url: URL) {
		try {
			let response;
			switch (url.protocol) {
				case "file:":
					response = await this.requestFile(url);
					break;
				case "https:":
				case "http:":
					response = await this.requestHTTP(url);
					break;
				default:
					throw new Error(url.href);
			}
			if (!await this.filterAttachment(response)) {
				return "skipped";
			}
			let filename = getURLFilename(url);
			const { data, mime: actualMime } = response;
			if ((mime(splitFilename(filename).extension) || "application/octet-stream") !== actualMime) {
				const ext = extension(actualMime);
				if (ext) {
					filename += `.${ext}`;
				}
			}
			return await this.writeAttachment(mdFile, filename, data);
		} catch (e) {
			console.error(e);
			return "failed";
		}
	}

	async requestFile(url: URL) {
		const data = (await fsPromises.readFile(nodeUrl.fileURLToPath(url.href))).buffer;
		return { mime: await detectMime(url, data), data };
	}

	async requestHTTP(url: URL) {
		url = new URL(url.href);
		let response;
		try {
			url.protocol = "https:";
			response = await requestUrl({
				url: url.href,
				method: "GET",
				throw: true,
			});
		} catch (e) {
			try {
				url.protocol = "http:";
				response = await requestUrl({
					url: url.href,
					method: "GET",
					throw: true,
				});
			} catch (e2) {
				console.error(e2);
				throw e;
			}
		}
		const { arrayBuffer: data } = response;
		return { mime: response.headers["Content-Type"] || await detectMime(url, data), data };
	}

	async writeAttachment(mdFile: TFile, filename: string, data: ArrayBufferLike) {
		const { basename, extension } = splitFilename(sanitizeFileName(filename));
		let error;
		for (let retry = 0; retry < 5; ++retry) {
			try {
				//@ts-ignore
				const path: string = await this.app.vault.getAvailablePathForAttachments(basename, extension, mdFile);
				return await this.app.vault.createBinary(path, data);
			} catch (e) {
				// retry in case `path` is the same for multiple invocations of `writeAttachment`
				error = e;
				await sleep(1000 * Math.random());
			}
		}
		throw error;
	}

	async filterAttachment(response: Response) {
		const { data, mime } = response;
		return this.filterAttachmentSize(data) && this.filterAttachmentMime(mime) && await this.filterImageSize(response);
	}

	filterAttachmentSize(data: ArrayBufferLike) {
		const { byteLength } = data;
		return !this.attachmentSizeLimit || byteLength <= this.attachmentSizeLimit;
	}

	filterAttachmentMime(mime: string) {
		return ["audio/", "image/", "video/"]
			.some(prefix => mime.startsWith(prefix));
	}

	async filterImageSize(response: Response) {
		const { mime, data } = response;
		if (!this.minimumImageSize || !mime.startsWith("image/")) {
			return true;
		}
		let size;
		try {
			size = await imageSize(new Blob([data], { type: mime }));
		} catch {
			return true;
		}
		const { height, width } = size;
		return width >= this.minimumImageSize && height >= this.minimumImageSize;
	}
}

interface Response {
	mime: string;
	data: ArrayBufferLike;
}

function getURLFilename(url: URL) {
	return pathToFilename(normalizePath(decodeURI(url.pathname)));
}

async function detectMime(url: URL, data: ArrayBufferLike) {
	return mime(splitFilename(getURLFilename(url)).extension) ||
		((await fileType.fileTypeFromBuffer(data))?.mime ??
			(isSvg(data) ? "image/svg+xml" : "application/octet-stream"));
}

function isSvg(data: ArrayBufferLike) {
	return Buffer.from(data).includes("<svg");
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

// todo: use internal md parser (but consider performance first)
function parseMarkdownLink(
	link: string,
	strict: boolean = true,
) {
	// cannot use regex, example: `parseMarkdownLink("![a(b)c[d\\]e]f](g[h]i(j\\)k)l)")`
	function parseComponent(
		str: string,
		escaper: string,
		[start, end]: [string, string],
	): [ret: string, read: number] {
		let ret = "";
		let read = 0;
		let level = 0;
		let escaping = false;
		for (const codePoint of str) {
			read += codePoint.length;
			if (escaping) {
				ret += codePoint;
				escaping = false;
				continue;
			}
			switch (codePoint) {
				case escaper:
					escaping = true;
					break;
				case start:
					if (level > 0) {
						ret += codePoint;
					}
					++level;
					break;
				case end:
					--level;
					if (level > 0) {
						ret += codePoint;
					}
					break;
				default:
					ret += codePoint;
					break;
			}
			if (level <= 0) {
				break;
			}
		}
		if (level > 0 ||
			read <= String.fromCodePoint((str || "\x00").charCodeAt(0)).length) {
			return ["", -1];
		}
		return [ret, read];
	}
	const link2 = link.startsWith("!") ? link.slice("!".length) : link;
	const [display, read] = parseComponent(link2, "\\", ["[", "]"]);
	if (read < 0) {
		return null;
	}
	const rest = link2.slice(read);
	const [pathtext, read2] = parseComponent(rest, "\\", ["(", ")"]);
	if (read2 < 0) {
		return null;
	}
	let pathParts;
	if (strict) {
		pathParts = pathtext.split(/ +/u, 2);
	} else {
		pathParts = pathtext.split(/ +(?=")/u);
		if (pathParts.length > 2) {
			pathParts = [pathParts.slice(0, -1).join(""), pathParts.at(-1)];
		}
	}
	const [, title] = (/^"(?<title>(?:\\"|[^"])*)"$/u).exec(pathParts[1] ?? '""') ?? [];
	if (title === undefined) {
		return null;
	}
	return {
		display,
		path: decodeURI(pathParts[0] ?? ""),
		read: (link.startsWith("!") ? "!".length : 0) + read + read2,
		title,
	};
}
