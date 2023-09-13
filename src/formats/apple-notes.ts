import { CachedMetadata, Setting, TFile, TFolder } from 'obsidian';
import { NodePickedFile, PickedFile, url as nodeUrl } from '../filesystem';
import { ImportContext } from '../main';
import { parseHTML, stringToUtf8 } from '../util';
import { run } from '@jxa/run';
import { exportNotes } from './apple-notes/export';
import { fixDocumentUrls, HtmlImporter } from './html';
import { toMd } from '2md';

export class AppleNotesImporter extends HtmlImporter {
	attachmentSizeLimit: number;
	minimumImageSize: number;

	init() {
		this.exportNotes();
		this.addFileChooserSetting('HTML', ['htm', 'html'], true);
	}

	exportNotes() {
		new Setting(this.modal.contentEl)
			.setName('Export')
			.setDesc('This will export all your Apple Notes')
			.addButton((button) =>
				button.setButtonText('Export').onClick(async () => {
					run(exportNotes);
				})
			);
	}

	override async processFile(
		ctx: ImportContext,
		folder: TFolder,
		file: PickedFile
	) {
		ctx.status('Processing ' + file.name);
		try {
			const htmlContent = await file.readText();

			const dom = parseHTML(htmlContent);
			fixDocumentUrls(dom);

			// Find all the attachments and download them
			const baseUrl =
				file instanceof NodePickedFile
					? nodeUrl.pathToFileURL(file.filepath)
					: undefined;
			const attachments = new Map<string, TFile | null>();
			const attachmentLookup = new Map<string, TFile>();
			for (let el of dom.findAll('img, audio, video')) {
				if (ctx.isCancelled()) return;

				let src = el.getAttribute('src');
				if (!src) continue;

				try {
					const url = new URL(
						src.startsWith('//') ? `https:${src}` : src,
						baseUrl
					);

					let key = url.href;
					let attachmentFile = attachments.get(key);
					if (!attachments.has(key)) {
						ctx.status('Downloading attachment for ' + file.name);
						attachmentFile = await this.downloadAttachment(
							folder,
							el,
							url
						);
						attachments.set(key, attachmentFile);
						if (attachmentFile) {
							attachmentLookup.set(
								attachmentFile.path,
								attachmentFile
							);
							ctx.reportAttachmentSuccess(attachmentFile.name);
						} else {
							ctx.reportSkipped(src);
						}
					}

					if (attachmentFile) {
						// Convert the embed into a vault absolute path
						el.setAttribute(
							'src',
							attachmentFile.path.replace(/ /g, '%20')
						);

						// Convert `<audio>` and `<video>` into `<img>` so that htmlToMarkdown can properly parse it.
						if (!(el instanceof HTMLImageElement)) {
							el.replaceWith(
								createEl('img', {
									attr: {
										src: attachmentFile.path.replace(
											/ /g,
											'%20'
										),
										alt: el.getAttr('alt'),
									},
								})
							);
						}
					}
				} catch (e) {
					ctx.reportFailed(src, e);
				}
			}

			let mdContent = toMd(dom.innerHTML);
			let mdFile = await this.saveAsMarkdownFile(
				folder,
				file.basename,
				mdContent
			);

			// Because `htmlToMarkdown` always gets us markdown links, we'll want to convert them into wikilinks, or relative links depending on the user's preference.
			if (!Object.isEmpty(attachments)) {
				// Attempt to parse links using MetadataCache
				let { metadataCache } = this.app;
				let cache: CachedMetadata;
				// @ts-ignore
				if (metadataCache.computeMetadataAsync) {
					// @ts-ignore
					cache = (await metadataCache.computeMetadataAsync(
						stringToUtf8(mdContent)
					)) as CachedMetadata;
				} else {
					cache = await new Promise<CachedMetadata>((resolve) => {
						let cache = metadataCache.getFileCache(mdFile);
						if (cache) return resolve(cache);
						const ref = metadataCache.on(
							'changed',
							(file, content, cache) => {
								if (file === mdFile) {
									metadataCache.offref(ref);
									resolve(cache);
								}
							}
						);
					});
				}

				// Gather changes to make to the document
				let changes = [];
				if (cache.embeds) {
					for (let { link, position } of cache.embeds) {
						if (attachmentLookup.has(link)) {
							let newLink =
								this.app.fileManager.generateMarkdownLink(
									attachmentLookup.get(link)!,
									mdFile.path
								);
							changes.push({
								from: position.start.offset,
								to: position.end.offset,
								text: newLink,
							});
						}
					}
				}

				// Apply changes from last to first
				changes.sort((a, b) => b.from - a.from);
				for (let change of changes) {
					mdContent =
						mdContent.substring(0, change.from) +
						change.text +
						mdContent.substring(change.to);
				}

				await this.vault.modify(mdFile, mdContent);
			}

			ctx.reportNoteSuccess(file.fullpath);
		} catch (e) {
			ctx.reportFailed(file.fullpath, e);
		}
	}
}
