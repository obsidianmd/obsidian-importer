import { normalizePath, Notice, requestUrl, TFile, TFolder } from 'obsidian';
import {
	fsPromises,
	nodeBufferToArrayBuffer,
	NodePickedFile,
	parseFilePath,
	PickedFile,
	PickedFolder,
	url as nodeUrl,
} from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, PlannedNote } from '../format-importer';
import { convertHtmlDocument } from './html/convert';
import { ImportContext } from '../import-context';
import { ImportedPathIndex, normalizeTreePath, parentTreePath, resolveTreePath } from '../imported-path-index';
import { i18n } from '../i18n';
import { MarkdownLinkResolver } from '../markdown-output';
import { extensionForMime } from '../mime';
import { pickedFolderNodes, pickedFolderSelection, PickedFolderNode } from '../picked-folder-tree';
import { TreePicker } from '../tree-view';
import { countText, describeReason, sanitizeFileName } from '../util';

interface PlannedHtml {
	parent: string;
	source: string;
	file: PickedFile | null;
	note?: PlannedNote;
}

export class HtmlImporter extends FormatImporter {
	static extensions = ['htm', 'html'];

	interruption = 'pause' as const;

	attachmentSizeLimit: number;
	minimumImageSize: number;
	private picker: TreePicker<PickedFolderNode>;
	private loadedFrom: string;
	private skipping: Set<string>;
	private taking: Set<string> | null;
	private importedPaths: ImportedPathIndex<TFile>;
	private importedUrls: ImportedPathIndex<TFile>;
	private linkedOutputs: Map<string, TFile>;

	init(): void {
		this.loadedFrom = '';
		this.skipping = new Set();
		this.taking = null;
		this.importedPaths = new ImportedPathIndex();
		this.importedUrls = new ImportedPathIndex();
		this.linkedOutputs = new Map();

		this.keepsFolders = true;
		this.addExportSetting(i18n.importer.html.descExport());
		this.addFileChooserSetting(
			i18n.importer.html.fileType(), HtmlImporter.extensions, true,
			i18n.importer.html.descSource());
		this.drawFolderPicker();
		this.addAttachmentSizeLimit(0);
		this.addMinimumImageSize(65); // 65 so that 64×64 are excluded
		this.defaultOutputFolder = 'HTML import';
	}

	protected override get markdownLinkResolver(): MarkdownLinkResolver {
		return (path, sourcePath) => this.resolveImportedLink(path, sourcePath);
	}

	private source(): (PickedFile | PickedFolder)[] {
		return this.chosen.length > 0 ? this.chosen : this.files;
	}

	protected sourceChanged(): void {
		super.sourceChanged();

		this.picker?.toggle(this.source().length > 0);

		const key = this.source().map(item => item.toString()).join('\n');
		if (key === this.loadedFrom) return;

		this.loadedFrom = key;
		if (this.picker) void this.loadFolders();
	}

	private drawFolderPicker(): void {
		this.draw(contentEl => {
			this.picker = new TreePicker<PickedFolderNode>(contentEl, {
				setting: this.addSetting('source'),
				name: i18n.importer.html.nameFolders(),
				desc: i18n.importer.html.descFolders(),
				hint: i18n.importer.html.msgPickSourceFirst(),
				loading: i18n.importer.html.msgReadingFolders(),
				empty: i18n.importer.html.msgNoFolders(),
				failed: error => describeReason(error),
				view: {
					icon: node => node.children?.length && !node.collapsed ? 'folder-open' : 'folder',
					flair: node => countText(node.files),
				},
				loadsItself: true,
			});

			this.picker.toggle(this.source().length > 0);
		}, 'source');
	}

	private async loadFolders(): Promise<void> {
		const source = this.source();
		if (source.length === 0) {
			this.picker.reset();
			return;
		}

		await this.picker.load(isCurrent => pickedFolderNodes(source, {
			countFile: file => HtmlImporter.extensions.includes(file.extension),
			isCurrent,
		}));
	}

	private planSelection(): void {
		const selection = pickedFolderSelection(this.picker?.nodes ?? []);
		this.skipping = selection.skipped;
		this.taking = selection.included;
	}

	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return files.some(file => HtmlImporter.extensions.includes(file.extension)) ? files.length : 0;
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

		this.planSelection();
		this.importedPaths.clear();
		this.importedUrls.clear();
		this.linkedOutputs.clear();
		const planned = await this.plan(ctx, source, folder.path === '/' ? '' : folder.path);
		this.preparePlan(planned);

		const notes = planned.filter(item => item.file);
		// Existing notes compare links against targets that must already exist.
		const ordered = [
			...notes.filter(item => !item.note?.file),
			...notes.filter(item => item.note?.file),
			...planned.filter(item => !item.file),
		];

		let done = 0;
		ctx.reportProgress(done, ordered.length);
		for (const item of ordered) {
			if (await ctx.shouldStop()) return;

			ctx.status(i18n.common.statusProcessing({ name: item.file?.name ?? item.parent }));
			try {
				if (item.file) await this.processFile(ctx, item);
				else await this.createFolders(item.parent);
			}
			catch (error) {
				ctx.reportFailed(item.file?.fullpath ?? item.parent, error);
			}

			ctx.reportProgress(++done, ordered.length);
		}
	}

	private async plan(
		ctx: ImportContext,
		items: (PickedFile | PickedFolder)[],
		into: string,
		chosen = true,
		from = '',
	): Promise<PlannedHtml[]> {
		const planned: PlannedHtml[] = [];

		for (const item of items) {
			if (await ctx.shouldStop()) return planned;

			try {
				if (item.type === 'file') {
					if (!HtmlImporter.extensions.includes(item.extension)) continue;
					if (from && this.taking && !this.taking.has(from)) continue;

					planned.push({ parent: into, source: under(from, item.name), file: item });
					continue;
				}

				const source = under(from, item.name);
				if (this.skipping.has(source)) continue;

				const name = sanitizeFileName(item.name, into);
				const desired = normalizePath(into ? `${into}/${name}` : name);
				const existing = this.vault.getAbstractFileByPathInsensitive(desired);
				let at: string;

				if (chosen && this.duplicateHandling === DuplicateHandling.CreateCopy) {
					at = this.freeFilePath(into, name);
				}
				else if (existing instanceof TFolder) {
					at = existing.path;
				}
				else if (existing || this.hasClaimed(desired)) {
					at = this.freeFilePath(into, name);
				}
				else {
					at = desired;
				}

				this.claimPath(at);
				const inside = await this.plan(ctx, await item.list(), at, false, source);
				if (inside.length === 0) planned.push({ parent: at, source, file: null });
				else for (const child of inside) planned.push(child);
			}
			catch (error) {
				ctx.reportFailed(item.name, error);
			}
		}

		return planned;
	}

	private preparePlan(items: PlannedHtml[]): void {
		for (const item of items) {
			if (!item.file) continue;

			item.note = this.planNote(item.parent || '/', item.file.basename);
			if (item.note.file) this.rememberImported(item.source, item.file, item.note.file);
		}
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
		const htmlContent = await file.readText();
		const baseUrl = file instanceof NodePickedFile ? nodeUrl.pathToFileURL(file.filepath) : undefined;
		const allowedBaseDirUrl = baseUrl ? new URL('./', baseUrl.href).href : undefined;

		const { markdown } = await convertHtmlDocument(htmlContent, {
			baseUrl,
			isCancelled: () => ctx.isCancelled(),
			resolveAttachment: async (url, el) => {
				ctx.status(i18n.importer.html.statusDownloading({ name: file.name }));
				const attachment = await this.downloadAttachment(el, url, planned.targetPath, allowedBaseDirUrl);
				if (!attachment) return null;

				this.linkedOutputs.set(attachment.path.toLowerCase(), attachment);
				return { path: attachment.path, name: attachment.name };
			},
			onAttachment: attachment => ctx.reportAttachmentSuccess(attachment.name),
			onSkipped: src => ctx.reportSkipped(src),
			onFailed: (src, error) => ctx.reportFailed(src, error),
		});

		const { file: imported, written } = await this.writePlannedNote(ctx, planned, markdown, { disposition });
		this.rememberImported(item.source, file, imported);
		if (written) ctx.reportNoteSuccess(file.fullpath);
	}

	async downloadAttachment(el: HTMLElement, url: URL, notePath: string, allowedBaseDirUrl?: string) {
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

		const filename = extension ? `${basename}.${extension}` : basename;
		const path = await this.getAvailablePathForAttachment(filename, [], notePath);

		return await this.vault.createBinary(path, data);
	}

	private rememberImported(source: string, picked: PickedFile, imported: TFile): void {
		this.importedPaths.remember(source, imported);
		if (!(picked instanceof NodePickedFile)) return;

		const href = nodeUrl.pathToFileURL(picked.filepath).href;
		this.importedUrls.remember(href, imported);
		this.importedUrls.remember(safeDecode(href), imported);
	}

	private resolveImportedLink(path: string, outputPath: string): TFile | null {
		const query = path.indexOf('?');
		const withoutSearch = query < 0 ? path : path.slice(0, query);
		const decoded = safeDecode(withoutSearch);

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
		for (const candidate of decoded.startsWith('/') ? [root] : [relative, root]) {
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

function under(from: string, name: string): string {
	return from ? `${from}/${name}` : name;
}

function safeDecode(path: string): string {
	try {
		return decodeURIComponent(path);
	}
	catch {
		return path;
	}
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
