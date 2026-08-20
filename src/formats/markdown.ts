import { normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { fsPromises, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, PlannedNote } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { MarkdownFormatting, MarkdownLinkResolver } from '../markdown-output';
import { TreePicker, ViewableNode } from '../tree-view';
import { countText, describeReason, sanitizeFileName } from '../util';
import { readZip, ZipEntryFile, zipContents } from '../zip';
import { convertMarkdownNote } from './markdown/convert';

const MARKDOWN_EXTS = ['md', 'markdown'];

/** Obsidian's own formats, which are copied across as they were written. */
const NATIVE_EXTS = ['base', 'canvas'];

/** A zip is a folder that has been packed up, which is how a phone offers one. */
const SOURCE_EXTS = [...MARKDOWN_EXTS, ...NATIVE_EXTS, 'zip'];

/** A folder the import found, named by where it sits under what was chosen. */
interface FolderNode extends ViewableNode<FolderNode> {
	path: string;
	/** Notes inside it, the ones in the folders under it included. */
	notes: number;
}

interface PlannedItem {
	parent: string;
	/** Where the item was addressed in the source tree. */
	source: string;
	/** Null represents an empty folder. */
	file: PickedFile | null;
	note?: PlannedNote;
	attachment?: PlannedAttachment | null;
}

interface PlannedAttachment {
	path: string;
	reuse: TFile | null;
	times?: FileTimes;
}

/** What the source recorded, for a note that keeps its dates. */
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

/**
 * What a vault, or the tool that versions it, keeps for itself.
 *
 * Only ever skipped on the way down: a folder named this and picked on purpose
 * is one the user asked for.
 */
function isHidden(item: PickedFile | PickedFolder): boolean {
	return item.name.startsWith('.');
}

/** Where a folder sits under what was chosen, which is how the plan finds it again. */
function under(from: string, name: string): string {
	return from ? `${from}/${name}` : name;
}

async function folderNodes(items: (PickedFile | PickedFolder)[], from: string): Promise<FolderNode[]> {
	const nodes: FolderNode[] = [];

	for (const item of items) {
		if (item.type !== 'folder') continue;
		if (from && isHidden(item)) continue;

		const path = under(from, item.name);
		const inside = await item.list();
		const children = await folderNodes(inside, path);

		nodes.push({
			title: item.name,
			path,
			notes: inside.filter(child => child.type === 'file' && !isHidden(child) && isMarkdown(child)).length
				+ children.reduce((total, child) => total + child.notes, 0),
			selected: true,
			disabled: false,
			// The top level is open, so what was chosen shows what is in it.
			collapsed: from !== '',
			children,
		});
	}

	return nodes;
}

async function fileTimes(file: PickedFile): Promise<FileTimes | undefined> {
	if (file instanceof ZipEntryFile) {
		const mtime = (file.mtime ?? file.ctime)?.getTime();
		return mtime ? { ctime: (file.ctime ?? file.mtime)!.getTime(), mtime } : undefined;
	}

	if (!(file instanceof NodePickedFile)) return undefined;

	try {
		const stat = await fsPromises.stat(file.filepath);

		// Obsidian's write options take whole milliseconds, and a filesystem
		// reports fractions of one.
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
	// A zip is offered for a drop as well; the rest are only picked on purpose.
	static extensions = [...MARKDOWN_EXTS, 'zip'];

	interruption = 'pause' as const;

	// No initializers: the base constructor calls init() first.
	standardizeFormatting: boolean;
	tagsAsProperties: boolean;
	private picker: TreePicker<FolderNode>;
	private loadedFrom: string;
	private loadGeneration: number;
	private skipping: Set<string>;
	/** Folders whose own files come across; null when nothing is picking them out. */
	private taking: Set<string> | null;
	private importedFrom: Map<string, TFile>;
	private importedFromFolded: Map<string, Map<string, TFile>>;
	private sourceOf: Map<string, string>;
	private outputRoot: string;
	private linksNeedRepair: boolean;

	init(): void {
		this.defaultOutputFolder = 'Markdown';
		this.standardizeFormatting = true;
		this.tagsAsProperties = false;
		this.loadedFrom = '';
		this.loadGeneration = 0;
		this.skipping = new Set();
		this.taking = null;
		this.importedFrom = new Map();
		this.importedFromFolded = new Map();
		this.sourceOf = new Map();
		this.outputRoot = '';
		this.linksNeedRepair = false;

		// A folder is what the structure is read from, so it is kept as one.
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

	/** What was chosen or dropped, or the files a scripted import was handed. */
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
			this.picker = new TreePicker<FolderNode>(contentEl, {
				setting: this.addSetting('source'),
				name: i18n.importer.markdown.nameFolders(),
				desc: i18n.importer.markdown.descFolders(),
				hint: i18n.importer.markdown.msgPickSourceFirst(),
				loading: i18n.importer.markdown.msgReadingFolders(),
				empty: i18n.importer.markdown.msgNoFolders(),
				failed: error => describeReason(error),
				view: {
					icon: node => node.children?.length && !node.collapsed ? 'folder-open' : 'folder',
					flair: node => countText(node.notes),
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

		const generation = ++this.loadGeneration;

		await this.picker.load(async () => {
			let nodes: FolderNode[] = [];
			await this.opened(source, async items => {
				nodes = await folderNodes(items, '');
			});

			// Ignore a walk overtaken by a later one.
			return generation === this.loadGeneration ? nodes : this.picker.nodes;
		});
	}

	/**
	 * What the ticks come to: the folders to walk past, and the folders whose own
	 * files are wanted. A folder nobody ticked is still walked into when
	 * something under it was, and gives up only what is below.
	 */
	private planSelection(): void {
		this.skipping = new Set();
		this.taking = this.picker?.nodes.length ? new Set() : null;
		if (!this.taking) return;

		const walk = (nodes: FolderNode[]): boolean => {
			let wanted = false;

			for (const node of nodes) {
				const below = walk(node.children ?? []);

				if (node.selected) this.taking!.add(node.path);
				else if (!below) this.skipping.add(node.path);

				wanted ||= node.selected || below;
			}

			return wanted;
		};

		walk(this.picker!.nodes);
	}

	/**
	 * A folder comes whole, so what is dropped with a note in it is all taken:
	 * the files beside a note are what its links point at.
	 */
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
		this.importedFrom.clear();
		this.importedFromFolded.clear();
		this.sourceOf.clear();
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

	/** Settle every destination before reading note content, so link comparisons see the completed map. */
	private async preparePlan(ctx: ImportContext, items: PlannedItem[]): Promise<boolean> {
		// Notes win name collisions regardless of their order in the source tree.
		for (const item of items) {
			const { file } = item;
			if (!file || !isMarkdown(file)) continue;

			item.note = this.planNote(item.parent || '/', file.basename);
			this.notePlannedPath(item.source, item.note.targetPath);
			if (item.note.file) this.rememberImported(item.source, item.note.file);
		}

		for (const item of items) {
			const { file } = item;
			if (!file || isMarkdown(file)) continue;
			if (await ctx.shouldStop()) return false;

			try {
				item.attachment = await this.planAttachment(item.parent, item.source, file);
			}
			catch (error) {
				item.attachment = null;
				ctx.reportFailed(file.fullpath, error);
			}
		}

		return true;
	}

	/**
	 * Run the import with every picked zip open, since an entry can only be read
	 * through the archive it came from and that is closed on the way out.
	 */
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

	/**
	 * Where every chosen item is going, with the folders it came in preserved.
	 *
	 * A chosen folder keeps the name it had, so that importing it a second time
	 * lands on the same notes and can update them. Only asking for a copy each
	 * time numbers the folder instead - which is also what keeps two sources
	 * that happen to share a folder name apart.
	 */
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

				planned.push(...inside.length > 0 ? inside : [{ parent: at, source, file: null }]);
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
			this.rememberImported(source, planned.file!);
			return;
		}

		const { markdown } = convertMarkdownNote(await file.readText(), {
			tagsAsProperties: this.tagsAsProperties,
		});
		// A shared output-folder prefix leaves relative links alone, but an
		// absolute source link still has to be relocated with its target.
		if (!this.linksNeedRepair && hasAbsoluteLink(markdown)) this.linksNeedRepair = true;

		const { file: imported, written } = await this.writePlannedNote(ctx, planned, markdown, { ...times, disposition });
		this.rememberImported(source, imported);
		if (written) ctx.reportNoteSuccess(file.name);
	}

	/**
	 * Anything that is not a note, kept where it was so that a relative link
	 * written beside it still resolves. A second import lands on the same file
	 * again rather than numbering a copy, which would leave those links behind.
	 */
	private async planAttachment(parent: string, source: string, file: PickedFile): Promise<PlannedAttachment> {
		const folder = await this.createFolders(parent || '/');
		const at = folder.path === '/' ? '' : folder.path;
		const sanitized = sanitizeFileName(file.name, at);
		const dot = sanitized.lastIndexOf('.');
		const name = dot > 0 ? sanitized.slice(0, dot) : sanitized;
		const suffix = dot > 0 ? sanitized.slice(dot) : '';
		const candidate = (nth: number) => normalizePath(
			at ? `${at}/${name}${nth ? ` ${nth}` : ''}${suffix}` : `${name}${nth ? ` ${nth}` : ''}${suffix}`);

		const times = await fileTimes(file);
		let data: ArrayBuffer | undefined;
		const sourceData = async () => data ??= await file.read();
		const { path, reuse } = await this.placeAttachmentAt(candidate, async existing => {
			const data = await sourceData();
			if (existing.stat.size === data.byteLength) {
				const current = await this.vault.readBinary(existing);
				if (equalBytes(current, data)) return 'same';
			}

			if (times && existing.stat.ctime === times.ctime) {
				return times.mtime > existing.stat.mtime ? 'stale' : 'same';
			}

			return 'another';
		});

		this.notePlannedPath(source, path);
		const target = reuse ?? this.vault.getAbstractFileByPath(path);
		if (target instanceof TFile) this.rememberImported(source, target);

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
		this.rememberImported(source, imported);
		ctx.reportAttachmentSuccess(file.name);
	}

	private notePlannedPath(source: string, path: string): void {
		const relative = this.outputRoot && path.startsWith(`${this.outputRoot}/`)
			? path.slice(this.outputRoot.length + 1)
			: path;
		if (sourcePath(source).toLowerCase() !== sourcePath(relative).toLowerCase()) {
			this.linksNeedRepair = true;
		}
	}

	private rememberImported(source: string, file: TFile): void {
		const key = sourcePath(source);
		this.importedFrom.set(key, file);

		const folded = key.toLowerCase();
		let variants = this.importedFromFolded.get(folded);
		if (!variants) this.importedFromFolded.set(folded, variants = new Map());
		variants.set(key, file);

		this.sourceOf.set(file.path.toLowerCase(), key);
	}

	private importedAt(source: string): TFile | null {
		const exact = this.importedFrom.get(source);
		if (exact) return exact;

		const variants = this.importedFromFolded.get(source.toLowerCase());
		return variants?.size === 1 ? variants.values().next().value ?? null : null;
	}

	private resolveImportedLink(path: string, outputPath: string): TFile | null {
		const source = this.sourceOf.get(outputPath.toLowerCase());
		if (!source) return null;

		const absolute = path.startsWith('/');
		const wanted = path.replace(/\\/g, '/').replace(/^\/+/, '');
		const parent = source.slice(0, Math.max(0, source.lastIndexOf('/')));
		const relative = sourcePath(parent ? `${parent}/${wanted}` : wanted);
		const root = sourcePath(wanted);

		for (const candidate of absolute ? [root] : [relative, root]) {
			for (const key of [candidate, `${candidate}.md`, `${candidate}.markdown`]) {
				const imported = this.importedAt(key);
				if (imported && this.pathChanged(path, outputPath, imported)) return imported;
			}
		}

		return null;
	}

	private pathChanged(link: string, outputPath: string, imported: TFile): boolean {
		const wanted = link.replace(/\\/g, '/').replace(/^\/+/, '');
		const parent = outputPath.slice(0, Math.max(0, outputPath.lastIndexOf('/')));
		const expected = sourcePath(link.startsWith('/') || !parent ? wanted : `${parent}/${wanted}`).toLowerCase();
		const actual = imported.path.toLowerCase();

		return actual !== expected && actual.replace(/\.md$/, '') !== expected;
	}
}

/** Normalize a path in the source tree without letting `..` escape its root. */
function sourcePath(path: string): string {
	const parts: string[] = [];

	for (const part of path.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}

	return parts.join('/');
}

/** A cheap guard for the one link shape changed merely by moving the source tree under the output folder. */
function hasAbsoluteLink(content: string): boolean {
	return /!?\[\[\s*\/|!?\[[^\]]*\]\(\s*<?\//u.test(content);
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
	if (left.byteLength !== right.byteLength) return false;

	const a = new Uint8Array(left);
	const b = new Uint8Array(right);
	return a.every((byte, index) => byte === b[index]);
}
