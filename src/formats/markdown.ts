import { normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { fsPromises, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, PlannedNote } from '../format-importer';
import { ImportContext } from '../import-context';
import { ImportedPathIndex, normalizeTreePath, parentTreePath, resolveTreePath } from '../imported-path-index';
import { i18n } from '../i18n';
import { MarkdownFormatting, MarkdownLinkResolver } from '../markdown-output';
import { pickedFolderNodes, pickedFolderSelection, PickedFolderNode } from '../picked-folder-tree';
import { TreePicker } from '../tree-view';
import { countText, describeReason, sameBytes, sanitizeFileName } from '../util';
import { readZip, ZipEntryFile, zipContents } from '../zip';
import { convertMarkdownNote } from './markdown/convert';

const MARKDOWN_EXTS = ['md', 'markdown'];

const NATIVE_EXTS = ['base', 'canvas'];

const SOURCE_EXTS = [...MARKDOWN_EXTS, ...NATIVE_EXTS, 'zip'];

interface PlannedItem {
	parent: string;
	source: string;
	/** Null for an empty folder. */
	file: PickedFile | null;
	note?: PlannedNote;
	attachment?: PlannedAttachment;
}

interface PlannedAttachment {
	path: string;
	reuse: TFile | null;
	times?: FileTimes;
}

interface FileTimes {
	ctime: number;
	mtime: number;
}

function isMarkdown(file: PickedFile): boolean {
	return MARKDOWN_EXTS.includes(file.extension);
}

function isZip(file: PickedFile | PickedFolder): file is PickedFile {
	return file.type === 'file' && file.extension === 'zip';
}

/** Skip hidden descendants, but not an explicitly selected root. */
function isHidden(item: PickedFile | PickedFolder): boolean {
	return item.name.startsWith('.');
}

function under(from: string, name: string): string {
	return from ? `${from}/${name}` : name;
}

async function fileTimes(file: PickedFile): Promise<FileTimes | undefined> {
	if (file instanceof ZipEntryFile) {
		const mtime = (file.mtime ?? file.ctime)?.getTime();
		return mtime ? { ctime: (file.ctime ?? file.mtime).getTime(), mtime } : undefined;
	}

	if (!(file instanceof NodePickedFile)) return undefined;

	try {
		const stat = await fsPromises.stat(file.filepath);

		// Vault timestamps use integer milliseconds.
		return {
			ctime: Math.round(stat.birthtimeMs || stat.ctimeMs),
			mtime: Math.round(stat.mtimeMs),
		};
	}
	catch {
		return undefined;
	}
}

export class MarkdownImporter extends FormatImporter {
	static extensions = [...MARKDOWN_EXTS, 'zip'];

	interruption = 'pause' as const;

	// Initialized in init() because the base constructor calls it.
	standardizeFormatting: boolean;
	tagsAsProperties: boolean;
	private picker: TreePicker<PickedFolderNode>;
	private loadedFrom: string;
	private skipping: Set<string>;
	/** Selected folders, or null when no folder filter is active. */
	private taking: Set<string> | null;
	private importedPaths: ImportedPathIndex<TFile>;
	private outputRoot: string;
	private linksNeedRepair: boolean;

	init(): void {
		this.defaultOutputFolder = 'Markdown';
		this.standardizeFormatting = true;
		this.tagsAsProperties = false;
		this.loadedFrom = '';
		this.skipping = new Set();
		this.taking = null;
		this.importedPaths = new ImportedPathIndex();
		this.outputRoot = '';
		this.linksNeedRepair = false;

		this.keepsFolders = true;
		this.addFileChooserSetting(
			i18n.importer.markdown.fileType(), SOURCE_EXTS, true,
			i18n.importer.markdown.descSource());

		this.drawFolderPicker();

		this.addSetting()
			?.setName(i18n.importer.markdown.nameStandardizeFormatting())
			.setDesc(i18n.importer.markdown.descStandardizeFormatting())
			.addToggle(toggle => toggle
				.setValue(this.standardizeFormatting)
				.onChange(value => this.standardizeFormatting = value));

		this.addSetting()
			?.setName(i18n.importer.markdown.nameTagsAsProperties())
			.setDesc(i18n.importer.markdown.descTagsAsProperties())
			.addToggle(toggle => toggle
				.setValue(this.tagsAsProperties)
				.onChange(value => this.tagsAsProperties = value));
	}

	protected override get markdownFormatting(): MarkdownFormatting | undefined {
		return this.standardizeFormatting ? undefined : null;
	}

	protected override get markdownLinkResolver(): MarkdownLinkResolver | undefined {
		return this.linksNeedRepair
			? (path, sourcePath) => this.resolveImportedLink(path, sourcePath)
			: undefined;
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
				name: i18n.importer.markdown.nameFolders(),
				desc: i18n.importer.markdown.descFolders(),
				hint: i18n.importer.markdown.msgPickSourceFirst(),
				loading: i18n.importer.markdown.msgReadingFolders(),
				empty: i18n.importer.markdown.msgNoFolders(),
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

		await this.picker.load(async isCurrent => {
			let nodes: PickedFolderNode[] = [];
			await this.opened(source, async items => {
				nodes = await pickedFolderNodes(items, {
					includeFolder: (folder, parent) => !parent || !isHidden(folder),
					countFile: file => !isHidden(file) && isMarkdown(file),
					isCurrent,
				});
			});

			return nodes;
		});
	}

	/** Compile the tree selection into skipped subtrees and included folders. */
	private planSelection(): void {
		const selection = pickedFolderSelection(this.picker?.nodes ?? []);
		this.skipping = selection.skipped;
		this.taking = selection.included;
	}

	/** Accept an entire drop so relative links retain their neighboring files. */
	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return files.some(file => SOURCE_EXTS.includes(file.extension)) ? files.length : 0;
	}

	protected drawOutputSettings(contentEl: HTMLElement): void {
		this.addOutputFolderSetting(contentEl);
		this.addDuplicateHandlingSetting(contentEl);
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
		this.outputRoot = folder.path === '/' ? '' : folder.path;
		this.linksNeedRepair = false;

		await this.opened(source, async items => {
			const planned = await this.plan(ctx, items, this.outputRoot);
			if (!await this.preparePlan(ctx, planned)) return;

			let done = 0;
			ctx.reportProgress(done, planned.length);

			for (const { parent, source, file, note, attachment } of planned) {
				if (await ctx.shouldStop()) return;

				ctx.status(i18n.common.statusProcessing({ name: file ? file.name : parent }));
				try {
					if (!file) await this.createFolders(parent);
					else if (isMarkdown(file)) await this.importNote(ctx, parent, source, file, note!);
					else if (attachment) await this.copyAttachment(ctx, source, file, attachment);
				}
				catch (error) {
					ctx.reportFailed(file ? file.fullpath : parent, error);
				}

				ctx.reportProgress(++done, planned.length);
			}
		}, (name, error) => ctx.reportFailed(name, error));
	}

	/** Plan every destination before resolving links. */
	private async preparePlan(ctx: ImportContext, items: PlannedItem[]): Promise<boolean> {
		// Notes win path collisions regardless of source order.
		for (const item of items) {
			const { file } = item;
			if (!file || !isMarkdown(file)) continue;

			item.note = this.planNote(item.parent || '/', file.basename);
			this.notePlannedPath(item.source, item.note.targetPath);
			if (item.note.file) this.importedPaths.remember(item.source, item.note.file);
		}

		for (const item of items) {
			const { file } = item;
			if (!file || isMarkdown(file)) continue;
			if (await ctx.shouldStop()) return false;

			try {
				item.attachment = await this.planAttachment(item.parent, item.source, file);
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
			}
		}

		return true;
	}

	/** Keep zip archives open until all of their entries are imported. */
	private async opened(
		items: (PickedFile | PickedFolder)[],
		body: (items: (PickedFile | PickedFolder)[]) => Promise<void>,
		report?: (name: string, error: unknown) => void,
	): Promise<void> {
		const open = async (index: number, taken: (PickedFile | PickedFolder)[]): Promise<void> => {
			if (index === items.length) return await body(taken);

			const item = items[index];
			if (!isZip(item)) return await open(index + 1, [...taken, item]);

			let read = false;
			try {
				await readZip(item, async (_zip, entries) => {
					read = true;
					await open(index + 1, [...taken, ...zipContents(entries)]);
				});
			}
			catch (error) {
				if (read || !report) throw error;

				report(item.name, error);
				await open(index + 1, taken);
			}
		};

		await open(0, []);
	}

	/** Preserve source folders, numbering selected roots only in CreateCopy mode. */
	private async plan(
		ctx: ImportContext,
		items: (PickedFile | PickedFolder)[],
		into: string,
		chosen = true,
		from = '',
	): Promise<PlannedItem[]> {
		const planned: PlannedItem[] = [];

		for (const item of items) {
			if (!chosen && isHidden(item)) continue;

			try {
				if (item.type === 'file') {
					if (from && this.taking && !this.taking.has(from)) continue;

					planned.push({ parent: into, source: under(from, item.name), file: item });
					continue;
				}

				const source = under(from, item.name);
				if (this.skipping.has(source)) continue;

				const name = sanitizeFileName(item.name, into);

				let at = chosen && this.duplicateHandling === DuplicateHandling.CreateCopy
					? this.freeFilePath(into, name)
					: normalizePath(into ? `${into}/${name}` : name);
				const existing = this.vault.getAbstractFileByPathInsensitive(at);
				if (existing instanceof TFolder) at = existing.path;
				if (chosen) this.claimPath(at);

				const inside = await this.plan(ctx, await item.list(), at, false, source);

				if (inside.length === 0) planned.push({ parent: at, source, file: null });
				// Avoid the argument limit of planned.push(...inside).
				else for (const item of inside) planned.push(item);
			}
			catch (error) {
				ctx.reportFailed(item.name, error);
			}
		}

		return planned;
	}

	private async importNote(
		ctx: ImportContext,
		parent: string,
		source: string,
		file: PickedFile,
		planned: PlannedNote,
	): Promise<void> {
		await this.createFolders(parent || '/');
		const times = await fileTimes(file);

		const disposition = this.preflightNote(ctx, planned, times?.mtime);
		if (leavesTheNoteAlone(disposition)) {
			this.importedPaths.remember(source, planned.file!);
			return;
		}

		const { markdown } = convertMarkdownNote(await file.readText(), {
			tagsAsProperties: this.tagsAsProperties,
		});
		// Moving under an output root changes only absolute source links.
		if (!this.linksNeedRepair && hasAbsoluteLink(markdown)) this.linksNeedRepair = true;

		const { file: imported, written } = await this.writePlannedNote(ctx, planned, markdown, { ...times, disposition });
		this.importedPaths.remember(source, imported);
		if (written) ctx.reportNoteSuccess(file.name);
	}

	/** Keep attachments beside their notes and reuse recognized copies. */
	private async planAttachment(parent: string, source: string, file: PickedFile): Promise<PlannedAttachment> {
		const folder = await this.createFolders(parent || '/');
		const candidate = this.namingIn(folder.path === '/' ? '' : folder.path, file.name);

		const times = await fileTimes(file);
		let data: ArrayBuffer | undefined;
		const sourceData = async () => data ??= await file.read();
		const { path, reuse } = await this.placeAttachmentAt(candidate, async existing => {
			const data = await sourceData();
			if (existing.stat.size === data.byteLength) {
				const current = await this.vault.readBinary(existing);
				if (sameBytes(current, data)) return 'same';
			}

			if (times && existing.stat.ctime === times.ctime) {
				return times.mtime > existing.stat.mtime ? 'stale' : 'same';
			}

			return 'another';
		});

		this.notePlannedPath(source, path);
		const target = reuse ?? this.vault.getAbstractFileByPath(path);
		if (target instanceof TFile) this.importedPaths.remember(source, target);

		return { path, reuse, times };
	}

	private async copyAttachment(
		ctx: ImportContext,
		source: string,
		file: PickedFile,
		planned: PlannedAttachment,
	): Promise<void> {
		const { path, reuse, times } = planned;
		if (reuse) {
			ctx.reportSkipped(file.name, this.duplicateHandling === DuplicateHandling.Skip
				? i18n.reason.alreadyInVault()
				: i18n.reason.unchangedSinceImport());
			return;
		}

		const imported = await this.writeAttachment(path, await file.read(), times);
		this.importedPaths.remember(source, imported);
		ctx.reportAttachmentSuccess(file.name);
	}

	private notePlannedPath(source: string, path: string): void {
		const relative = this.outputRoot && path.startsWith(`${this.outputRoot}/`)
			? path.slice(this.outputRoot.length + 1)
			: path;
		if (normalizeTreePath(source).toLowerCase() !== normalizeTreePath(relative).toLowerCase()) {
			this.linksNeedRepair = true;
		}
	}

	private resolveImportedLink(path: string, outputPath: string): TFile | null {
		const source = this.importedPaths.sourceFor(outputPath);
		if (!source) return null;

		const relative = resolveTreePath(parentTreePath(source), path);
		const root = resolveTreePath('', path);

		for (const candidate of path.startsWith('/') ? [root] : [relative, root]) {
			for (const key of [candidate, `${candidate}.md`, `${candidate}.markdown`]) {
				const imported = this.importedPaths.get(key);
				if (imported && this.pathChanged(path, outputPath, imported)) return imported;
			}
		}

		return null;
	}

	private pathChanged(link: string, outputPath: string, imported: TFile): boolean {
		const expected = resolveTreePath(link.startsWith('/') ? '' : parentTreePath(outputPath), link).toLowerCase();
		const actual = imported.path.toLowerCase();

		return actual !== expected && actual.replace(/\.md$/, '') !== expected;
	}
}

function hasAbsoluteLink(content: string): boolean {
	return /!?\[\[\s*\/|!?\[[^\]]*\]\(\s*<?\//u.test(content);
}
