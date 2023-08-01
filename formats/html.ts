import { FormatImporter } from "../format-importer";
import { Notice, Setting, TFile, TFolder, htmlToMarkdown, normalizePath, requestUrl } from "obsidian";
import { pathToBasename, pathToFilename, sanitizeFileName, splitFilename } from '../util';
import { ImportResult } from '../main';
import { URL, fileURLToPath, pathToFileURL } from "url";
import { readFile } from "fs/promises";
import { disableFS, imageSize } from "image-size";
import { fileTypeFromBuffer } from "file-type";
import { extension, mime } from "./utils/mime";

disableFS(true);

export class HtmlImporter extends FormatImporter {
	attachments: Record<string, ReturnType<typeof this.downloadAttachment>> = {};

	attachmentSizeLimit: number;
	minimumImageSize: number;

	init() {
		this.addFileOrFolderChooserSetting('HTML (.htm .html)', ['htm', 'html']);
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
		let { filePaths } = this;
		if (filePaths.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		const results = await Promise.all(filePaths
			.map(path => this.processFile(folder, path)));
		this.showResult({
			total: results.map(({ total }) => total).reduce((left, right) => left + right, 0),
			failed: results.map(({ failed }) => failed).flat(),
			skipped: results.map(({ skipped }) => skipped).flat()
		});
	}

	async processFile(folder: TFolder, path: string) {
		const results: ImportResult = {
			total: 1,
			failed: [],
			skipped: []
		};
		let mdFile: TFile | null = null;
		try {
			let mdContent = htmlToMarkdown(await this.readPath(path));
			path = normalizePath(path);
			const pathURL = pathToFileURL(path);
			mdFile = await this.saveAsMarkdownFile(folder, pathToBasename(path), "");

			const ast = [];
			let read = -1;
			let next = 0;
			do {
				next = mdContent.indexOf("!", read + 1);
				if (next === -1) {
					next = mdContent.length;
				}
				ast.push(mdContent.slice(read, next));
				const link = parseMarkdownLink(mdContent.slice(next), false);
				if (link) {
					ast.push({
						link,
						text: mdContent.slice(next, next + link.read),
					});
					next += link.read;
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
							text = this.app.fileManager.generateMarkdownLink(attachment, path, "", display);
						}
						return { text, attachment, link } as const;
					} catch (e) {
						console.error(e);
						return { text: ast.text };
					}
				}));
			results.total += transformedAST
				.filter(({ link }) => link)
				.length;
			results.failed = results.failed.concat(transformedAST
				.filter(({ attachment }) => attachment === "failed")
				.map(({ link: { path } }) => path));
			results.skipped = results.skipped.concat(transformedAST
				.filter(({ attachment }) => attachment === "skipped")
				.map(({ link: { path } }) => path));

			mdContent = transformedAST.map(({ text }) => text).join("");
			await this.app.vault.modify(mdFile, mdContent);
		} catch (e) {
			console.error(e);
			results.failed.push(path);
			if (mdFile) {
				try {
					await this.app.vault.delete(mdFile);
				} catch (e) {
					console.error(e);
				}
			}
		}
		return results;
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
			if (!this.filterAttachment(response)) {
				return "skipped";
			}
			let filename = getURLFilename(url);
			const { data, mime: actualMime } = response;
			if ((mime(splitFilename(filename)[1]) || "application/octet-stream") !== actualMime) {
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
		const data = (await readFile(fileURLToPath(url))).buffer;
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
		const [basename, extension] = splitFilename(sanitizeFileName(filename));
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

	filterAttachment(response: Response) {
		const { data, mime } = response;
		return this.filterAttachmentSize(data) && this.filterAttachmentMime(mime) && this.filterImageSize(response);
	}

	filterAttachmentSize(data: ArrayBufferLike) {
		const { byteLength } = data;
		return !this.attachmentSizeLimit || byteLength <= this.attachmentSizeLimit;
	}

	filterAttachmentMime(mime: string) {
		return ["audio/", "image/", "video/"]
			.some(prefix => mime.startsWith(prefix));
	}

	filterImageSize(response: Response) {
		if (!this.minimumImageSize || !response.mime.startsWith("image/")) {
			return true;
		}
		let size;
		try {
			size = imageSize(Buffer.from(response.data));
		} catch (e) {
			if (e instanceof TypeError || e instanceof RangeError) {
				// image not recognized
				return true;
			}
			throw e;
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
	return mime(splitFilename(getURLFilename(url))[1]) ||
		((await fileTypeFromBuffer(data))?.mime ??
			(isSvg(data) ? "image/svg+xml" : "application/octet-stream"));
}

function isSvg(data: ArrayBufferLike) {
	return Buffer.from(data).includes("<svg");
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
