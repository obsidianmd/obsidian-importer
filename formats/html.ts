import { FormatImporter } from "../format-importer";
import { Notice, TFile, TFolder, htmlToMarkdown, normalizePath, parseLinktext, requestUrl } from "obsidian";
import { pathToBasename, pathToFilename, sanitizeFileName, splitFilename } from '../util';
import { ImportResult } from '../main';
import { URL, fileURLToPath, pathToFileURL } from "url";
import { readFile } from "fs/promises";
import { getExtension, getType } from "mime/lite";

export class HtmlImporter extends FormatImporter {
	attachments: Record<string, ReturnType<typeof this.downloadAttachment>> = {}

	init() {
		this.addFileOrFolderChooserSetting('HTML (.htm .html)', ['htm', 'html']);
		this.addOutputLocationSetting('HTML');
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

		const results = (await Promise.all(filePaths
			.map(path => this.processFile(folder, path))));
		this.showResult({
			total: results.map(({ total }) => total).reduce((l, r) => l + r, 0),
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
			mdFile = await this.saveAsMarkdownFile(folder, pathToBasename(path), "");

			// todo: use internal md parser
			const regex = /!\[(.*?)\]\((.+?)\)/gu;
			const pathURL = pathToFileURL(path);
			const attachments = Object.fromEntries(await Promise.all(
				[...mdContent.matchAll(regex)]
					.map(async ([, , link]) => {
						const corrected = link.startsWith("//") ? `https:${link}` : link;
						return [
							link,
							await this.downloadAttachmentCached(mdFile, new URL(corrected, pathURL))
						] as const;
					})
			));
			const attachmentEntries = Object.entries(attachments);
			results.total += attachmentEntries.length;
			results.failed = results.failed.concat(attachmentEntries
				.filter(([, result]) => result === "failed")
				.map(([link]) => link));
			results.skipped = results.skipped.concat(attachmentEntries
				.filter(([, result]) => result === "skipped")
				.map(([link]) => link));

			mdContent = mdContent.replace(regex, (str, alias, link) => {
				const attachment = attachments[link];
				if (!(attachment instanceof TFile)) {
					return str;
				}
				let { subpath } = parseLinktext(link);
				if (subpath) {
					subpath = `#${subpath}`;
				}
				return this.app.fileManager.generateMarkdownLink(attachment, path, subpath, alias);
			})
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
					throw new Error(url.toString());
			}
			const { type, data } = response;
			if (!this.filterType(type)) {
				return "skipped";
			}
			let filename = getURLFilename(url);
			if ((getType(filename) ?? "application/octet-stream") !== type) {
				const ext = getExtension(type);
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
		const type = getType(getURLFilename(url)) ?? "application/octet-stream";
		return { type, data: (await readFile(fileURLToPath(url))).buffer };
	}

	async requestHTTP(url: URL) {
		url = new URL(url.toString());
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
		const type = response.headers["Content-Type"] || (getType(getURLFilename(url)) ?? "application/octet-stream");
		return { type, data: response.arrayBuffer };
	}

	async writeAttachment(mdFile: TFile, filename: string, data: ArrayBuffer) {
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

	filterType(mimeType: string) {
		return ["audio/", "image/", "video/"]
			.some(prefix => mimeType.startsWith(prefix));
	}
}


function getURLFilename(url: URL) {
	return pathToFilename(normalizePath(decodeURI(url.pathname)));
}
