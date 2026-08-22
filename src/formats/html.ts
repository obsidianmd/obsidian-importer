import { normalizePath, Notice, requestUrl, TFile } from 'obsidian';
import {
	fsPromises,
	nodeBufferToArrayBuffer,
	NodePickedFile,
	parseFilePath,
	PickedFile,
	PickedFolder,
	url as nodeUrl,
} from '../filesystem';
import { FormatImporter, leavesTheNoteAlone, NoteTemplateSample, PlannedNote, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { convertHtmlDocument, HtmlDocumentMetadata, inspectHtmlDocument } from './html/convert';
import { ImportContext } from '../import-context';
import { ImportedPathIndex, normalizeTreePath, parentTreePath, resolveTreePath } from '../imported-path-index';
import { i18n } from '../i18n';
import { MarkdownLinkResolver } from '../markdown-output';
import { extensionForMime } from '../mime';
import { isHiddenPickedItem, PickedFolderLoad, PickedFolderPicker, pickedFolderFileCount, pickedFolderNodes, plannedPickedItems, PlannedPickedItem } from '../picked-folder-tree';
import { withZipContents } from '../zip';
import { sanitizeFileName } from '../util';

const HTML_EXTENSIONS = ['htm', 'html'];
const SOURCE_EXTENSIONS = [...HTML_EXTENSIONS, 'zip'];

interface PlannedHtml extends PlannedPickedItem {
	note?: PlannedNote;
	baseUrl?: URL;
}

interface IndexedSourceFile {
	path: string;
	file: PickedFile;
}

interface IndexedHtmlDocument extends HtmlDocumentMetadata {
	path: string;
}

export class HtmlImporter extends FormatImporter {
	static extensions = SOURCE_EXTENSIONS;

	interruption = 'pause' as const;

	attachmentSizeLimit: number;
	minimumImageSize: number;
	extractMainContent: boolean;
	private folderPicker: PickedFolderPicker;
	private importedPaths: ImportedPathIndex<TFile>;
	private importedUrls: ImportedPathIndex<TFile>;
	private linkedOutputs: Map<string, TFile>;
	private sourceFiles: ImportedPathIndex<IndexedSourceFile>;
	private sourceDocuments: ImportedPathIndex<IndexedHtmlDocument>;

	init(): void {
		this.importedPaths = new ImportedPathIndex();
		this.importedUrls = new ImportedPathIndex();
		this.linkedOutputs = new Map();
		this.sourceFiles = new ImportedPathIndex();
		this.sourceDocuments = new ImportedPathIndex();
		this.idProperty = 'html-source';
		this.idLabel = i18n.importer.html.labelId();
		this.duplicateCaveat = i18n.importer.html.descSourceIdentity();
		this.saveSourceId = false;
		this.extractMainContent = true;
		this.folderPicker = new PickedFolderPicker(
			() => this.source(),
			async (source, isCurrent) => {
				let loaded: PickedFolderLoad = { nodes: [], files: 0 };
				await withZipContents(source, async items => {
					const countFile = (file: PickedFile) =>
						!isHiddenPickedItem(file) && HTML_EXTENSIONS.includes(file.extension);
					const nodes = await pickedFolderNodes(items, {
						includeFolder: (folder, chosen) => chosen || !isHiddenPickedItem(folder),
						countFile,
						isCurrent,
					});
					loaded = {
						nodes,
						files: pickedFolderFileCount(items, nodes, countFile),
					};
				});
				return loaded;
			},
		);

		this.keepsFolders = true;
		this.addExportSetting(i18n.importer.html.descExport());
		this.addFileChooserSetting(
			i18n.importer.html.fileType(), SOURCE_EXTENSIONS, true,
			i18n.importer.html.descSource());
		this.draw(contentEl => this.folderPicker.draw(contentEl, this.addSetting('source')), 'source');
		this.addSetting()
			?.setName(i18n.importer.html.nameExtractMainContent())
			.setDesc(i18n.importer.html.descExtractMainContent())
			.addToggle(toggle => toggle
				.setValue(this.extractMainContent)
				.onChange(value => this.extractMainContent = value));
		this.addAttachmentSizeLimit(0);
		this.addMinimumImageSize(65); // 65 so that 64×64 are excluded
		this.defaultOutputFolder = 'HTML';
	}

	protected override get markdownLinkResolver(): MarkdownLinkResolver {
		return (path, sourcePath) => this.resolveImportedLink(path, sourcePath);
	}

	private source(): (PickedFile | PickedFolder)[] {
		return this.chosen.length > 0 ? this.chosen : this.files;
	}

	protected sourceChanged(): void {
		super.sourceChanged();
		this.folderPicker.changed();
	}

	takesWholeDrop(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): boolean {
		return files.some(file => SOURCE_EXTENSIONS.includes(file.extension));
	}

	addAttachmentSizeLimit(defaultInMB: number) {
		this.attachmentSizeLimit = defaultInMB * 10 ** 6;
		this.addSetting()
			?.setName(i18n.importer.html.nameSizeLimit())
			.setDesc(i18n.importer.html.descSetZeroToDisable())
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
			?.setName(i18n.importer.html.nameMinimumImageSize())
			.setDesc(i18n.importer.html.descSetZeroToDisable())
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

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		await withZipContents(this.source(), async items => {
			this.sourceFiles.clear();
			await this.indexSourceFiles(items);
			const planned = await plannedPickedItems(
				items,
				this.outputLocation.trim(),
				{
					selection: this.folderPicker.selection(),
					includeFile: (file, chosen) =>
						(chosen || !isHiddenPickedItem(file)) && HTML_EXTENSIONS.includes(file.extension),
					includeFolder: (picked, chosen) => chosen || !isHiddenPickedItem(picked),
					folderPath: (picked, parent, chosen) => this.mirroredFolderPath(parent, picked.name, chosen),
					onFolder: () => {},
					shouldStop: () => ctx.shouldStop(),
					onError: (item, error) => ctx.reportFailed(item.name, error),
				},
			);

			for (const item of planned) {
				if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
				if (!item.file) continue;

				const html = await item.file.readText();
				const baseUrl = this.sourceUrl(item.file, item.source);
				const metadata = inspectHtmlDocument(html, baseUrl);
				const title = htmlNoteTitle(metadata.title, item.file.basename);
				const path = normalizePath(`${item.parent}/${sanitizeFileName(title)}.md`);
				const { markdown, variables } = await convertHtmlDocument(html, {
					baseUrl,
					extractMainContent: this.extractMainContent,
					isCancelled: () => ctx.isCancelled(),
					resolveAttachment: async () => null,
				});
				samples.push({
					title,
					path,
					content: markdown,
					variables,
					sourceId: item.source,
				});
			}
		}, (name, error) => ctx.reportFailed(name, error));
		return samples;
	}

	async import(ctx: ImportContext): Promise<void> {
		const source = this.source();
		if (source.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		await withZipContents(source, async items => {
			this.importedPaths.clear();
			this.importedUrls.clear();
			this.linkedOutputs.clear();
			this.sourceFiles.clear();
			this.sourceDocuments.clear();
			await this.indexSourceFiles(items);

			const planned: PlannedHtml[] = await plannedPickedItems(
				items,
				folder.path === '/' ? '' : folder.path,
				{
					selection: this.folderPicker.selection(),
					includeFile: (file, chosen) =>
						(chosen || !isHiddenPickedItem(file)) && HTML_EXTENSIONS.includes(file.extension),
					includeFolder: (picked, chosen) => chosen || !isHiddenPickedItem(picked),
					folderPath: (picked, parent, chosen) => this.mirroredFolderPath(parent, picked.name, chosen),
					onFolder: (path, chosen) => {
						if (chosen) this.claimPath(path);
					},
					shouldStop: () => ctx.shouldStop(),
					onError: (item, error) => ctx.reportFailed(item.name, error),
				},
			);
			const pageCount = planned.filter(item => item.file).length;
			const progressTotal = planned.length + pageCount;
			if (!await this.preparePlan(ctx, planned, progressTotal)) return;

			const notes = planned.filter(item => item.file && item.note);
			const ordered = [
				...notes.filter(item => !item.note?.file),
				...notes.filter(item => item.note?.file),
				...planned.filter(item => !item.file),
				...planned.filter(item => item.file && !item.note),
			];

			let done = pageCount;
			for (const item of ordered) {
				if (await ctx.shouldStop()) return;

				if (!item.file || item.note) {
					ctx.status(i18n.common.statusProcessing({ name: item.file?.name ?? item.parent }));
					try {
						if (item.file) await this.processFile(ctx, item);
						else await this.createFolders(item.parent);
					}
					catch (error) {
						ctx.reportFailed(item.file?.fullpath ?? item.parent, error);
					}
				}

				ctx.reportProgress(++done, progressTotal);
			}
		}, (name, error) => ctx.reportFailed(name, error));
	}

	private async preparePlan(
		ctx: ImportContext,
		items: PlannedHtml[],
		progressTotal: number,
	): Promise<boolean> {
		const pages = items.filter((item): item is PlannedHtml & { file: PickedFile } => item.file !== null);
		let done = 0;
		ctx.reportProgress(done, progressTotal);

		for (const item of pages) {
			if (await ctx.shouldStop()) return false;

			try {
				const { file } = item;
				ctx.status(i18n.common.statusProcessing({ name: file.name }));
				item.baseUrl = this.sourceUrl(file, item.source);
				const metadata = inspectHtmlDocument(await file.readText(), item.baseUrl);
				this.sourceDocuments.remember(item.source, { path: item.source, ...metadata });
				item.note = await this.planTemplatedNote(
					item.parent || '/',
					htmlNoteTitle(metadata.title, file.basename),
					'',
					{ sourceId: item.source },
				);
				if (item.note.file) this.rememberImported(item.source, file, item.note.file);
			}
			catch (error) {
				ctx.reportFailed(item.file.fullpath, error);
			}

			ctx.reportProgress(++done, progressTotal);
		}

		return true;
	}

	private async processFile(ctx: ImportContext, item: PlannedHtml): Promise<void> {
		const file = item.file!;
		const planned = item.note!;
		const disposition = this.preflightNote(ctx, planned);
		if (leavesTheNoteAlone(disposition)) {
			this.rememberImported(item.source, file, planned.file!);
			return;
		}

		await this.createFolders(item.parent || '/');
		const baseUrl = item.baseUrl;
		const allowedBaseDirUrl = file instanceof NodePickedFile && baseUrl
			? new URL('./', baseUrl.href).href
			: undefined;

		const { markdown, variables } = await convertHtmlDocument(await file.readText(), {
			baseUrl,
			extractMainContent: this.extractMainContent,
			resolveFragment: href => this.resolveHeadingFragment(item.source, href),
			isCancelled: () => ctx.isCancelled(),
			resolveAttachment: async (url, el, source) => {
				ctx.status(i18n.importer.html.statusDownloading({ name: file.name }));
				const picked = this.linkedSourceFile(item.source, source);
				const attachment = await this.downloadAttachment(
					el, url, planned.targetPath, allowedBaseDirUrl, picked);
				if (!attachment) return null;

				this.linkedOutputs.set(attachment.path.toLowerCase(), attachment);
				return { path: attachment.path, name: attachment.name };
			},
			onAttachment: attachment => ctx.reportAttachmentSuccess(attachment.name),
			onSkipped: src => ctx.reportSkipped(src),
			onFailed: (src, error) => ctx.reportFailed(src, error),
		});

		const { file: imported, written } = await this.writePlannedNote(ctx, planned, markdown, {
			disposition,
			templateVariables: variables,
		});
		this.rememberImported(item.source, file, imported);
		if (written) ctx.reportNoteSuccess(file.fullpath);
	}

	async downloadAttachment(
		el: HTMLElement,
		url: URL,
		notePath: string,
		allowedBaseDirUrl?: string,
		picked?: PickedFile,
	) {
		let basename = '';
		let extension = '';
		let data: ArrayBuffer;
		if (picked) {
			basename = picked.basename;
			extension = picked.extension;
			data = await picked.read();
		}
		else {
			switch (url.protocol) {
				case 'file:': {
					if (!allowedBaseDirUrl) return null;
					if (!url.href.startsWith(allowedBaseDirUrl)) {
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

		const filename = extension ? `${basename}.${extension}` : basename;
		const path = await this.getAvailablePathForAttachment(filename, [], notePath);

		return await this.vault.createBinary(path, data);
	}

	private async indexSourceFiles(
		items: (PickedFile | PickedFolder)[],
		from = '',
		chosen = true,
	): Promise<void> {
		for (const item of items) {
			if (!chosen && isHiddenPickedItem(item)) continue;

			const source = from ? `${from}/${item.name}` : item.name;
			if (item.type === 'file') {
				const indexed = { path: source, file: item };
				this.sourceFiles.remember(source, indexed);
				if (item instanceof NodePickedFile) this.sourceFiles.remember(item.filepath, indexed);
			}
			else await this.indexSourceFiles(await item.list(), source, false);
		}
	}

	private linkedSource(page: string, link: string): IndexedSourceFile | null {
		if (link.startsWith('file:')) {
			try {
				const path = safeDecode(new URL(link).pathname);
				return this.sourceFiles.get(path);
			}
			catch {
				return null;
			}
		}
		if (/^[a-z][a-z\d+.-]*:/iu.test(link) || link.startsWith('//')) return null;

		const clean = safeDecode(link.split(/[?#]/u, 1)[0]);
		const slash = page.indexOf('/');
		const root = slash < 0 ? '' : page.slice(0, slash);
		const source = link.startsWith('/')
			? resolveTreePath(root, clean)
			: resolveTreePath(parentTreePath(page), clean);
		return this.sourceFiles.get(source);
	}

	private linkedSourceFile(page: string, link: string): PickedFile | undefined {
		return this.linkedSource(page, link)?.file;
	}

	private resolveHeadingFragment(page: string, href: string): string | null {
		const hash = href.indexOf('#');
		if (hash < 0 || hash === href.length - 1) return null;

		const link = href.slice(0, hash);
		const target = link ? this.linkedSource(page, link)?.path : page;
		if (!target) return null;

		const id = safeDecode(href.slice(hash + 1));
		const heading = this.sourceDocuments.get(target)?.headings.get(id);
		return heading ? `${link}#${encodeURIComponent(heading)}` : null;
	}

	private sourceUrl(file: PickedFile, source: string): URL {
		if (file instanceof NodePickedFile) return nodeUrl.pathToFileURL(file.filepath);

		const encoded = source.split('/').map(encodeURIComponent).join('/');
		return new URL(encoded, 'file:///');
	}

	private rememberImported(source: string, picked: PickedFile, imported: TFile): void {
		this.importedPaths.remember(source, imported);
		const href = this.sourceUrl(picked, source).href;
		this.importedUrls.remember(href, imported);
		this.importedUrls.remember(safeDecode(href), imported);
	}

	private resolveImportedLink(path: string, outputPath: string): TFile | null {
		const query = path.indexOf('?');
		const withoutSearch = query < 0 ? path : path.slice(0, query);
		const decoded = safeDecode(withoutSearch);
		if (!decoded) return null;

		if (/^[a-z][a-z\d+.-]*:/iu.test(decoded) || decoded.startsWith('//')) {
			return this.importedUrls.get(withoutSearch) ?? this.importedUrls.get(decoded);
		}

		const direct = normalizeTreePath(decoded);
		const relativeOutput = resolveTreePath(parentTreePath(outputPath), decoded);
		for (const candidate of [direct, relativeOutput]) {
			const linked = this.linkedOutputs.get(candidate.toLowerCase());
			if (linked) return linked;
		}

		const source = this.importedPaths.sourceFor(outputPath);
		if (!source) return null;

		const relative = resolveTreePath(parentTreePath(source), decoded);
		const root = resolveTreePath('', decoded);
		const slash = source.indexOf('/');
		const siteRoot = resolveTreePath(slash < 0 ? '' : source.slice(0, slash), decoded);
		for (const candidate of decoded.startsWith('/') ? [siteRoot, root] : [relative, root]) {
			for (const key of [candidate, `${candidate}.html`, `${candidate}.htm`]) {
				const imported = this.importedPaths.get(key);
				if (imported) return imported;
			}
		}

		return null;
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

function safeDecode(path: string): string {
	try {
		return decodeURIComponent(path);
	}
	catch {
		return path;
	}
}

function htmlNoteTitle(title: string, fallback: string): string {
	const chosen = title.trim() || fallback;
	return chosen.replace(/\.html?$/iu, '') || fallback;
}

function parseURL(url: URL) {
	return parseFilePath(normalizePath(decodeURIComponent(url.pathname)));
}

async function requestURL(url: URL): Promise<{ data: ArrayBuffer, mime: string }> {
	// requestUrl is not blocked by browser CORS rules.
	const response = await requestUrl(url.href);
	return {
		data: response.arrayBuffer,
		mime: headerValue(response.headers, 'content-type') ?? '',
	};
}

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
