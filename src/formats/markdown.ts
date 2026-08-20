import { normalizePath, Notice, TFile } from 'obsidian';
import { fsPromises, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { MarkdownFormatting } from '../markdown-output';
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
	/** Null represents an empty folder. */
	file: PickedFile | null;
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

	init(): void {
		this.defaultOutputFolder = 'Markdown';
		this.standardizeFormatting = true;
		this.tagsAsProperties = false;
		this.loadedFrom = '';
		this.loadGeneration = 0;
		this.skipping = new Set();
		this.taking = null;

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

		await this.opened(source, async items => {
			const planned = await this.plan(ctx, items, folder.path === '/' ? '' : folder.path);

			let done = 0;
			ctx.reportProgress(done, planned.length);

			for (const { parent, file } of planned) {
				if (await ctx.shouldStop()) return;

				ctx.status(i18n.common.statusProcessing({ name: file ? file.name : parent }));
				try {
					if (!file) await this.createFolders(parent);
					else if (isMarkdown(file)) await this.importNote(ctx, parent, file);
					else await this.copyAttachment(ctx, parent, file);
				}
				catch (error) {
					ctx.reportFailed(file ? file.fullpath : parent, error);
				}

				ctx.reportProgress(++done, planned.length);
			}
		}, (name, error) => ctx.reportFailed(name, error));
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

					planned.push({ parent: into, file: item });
					continue;
				}

				const source = under(from, item.name);
				if (this.skipping.has(source)) continue;

				const name = sanitizeFileName(item.name, into);

				const at = chosen && this.duplicateHandling === DuplicateHandling.CreateCopy
					? this.freeFilePath(into, name)
					: normalizePath(into ? `${into}/${name}` : name);
				if (chosen) this.claimPath(at);

				const inside = await this.plan(ctx, await item.list(), at, false, source);

				planned.push(...inside.length > 0 ? inside : [{ parent: at, file: null }]);
			}
			catch (error) {
				ctx.reportFailed(item.name, error);
			}
		}

		return planned;
	}

	private async importNote(ctx: ImportContext, parent: string, file: PickedFile): Promise<void> {
		const folder = await this.createFolders(parent || '/');
		const times = await fileTimes(file);

		const planned = this.planNote(folder, file.basename);
		const disposition = this.preflightNote(ctx, planned, times?.mtime);
		if (leavesTheNoteAlone(disposition)) return;

		const { markdown } = convertMarkdownNote(await file.readText(), {
			tagsAsProperties: this.tagsAsProperties,
		});

		const { written } = await this.writePlannedNote(ctx, planned, markdown, { ...times, disposition });
		if (written) ctx.reportNoteSuccess(file.name);
	}

	/**
	 * Anything that is not a note, kept where it was so that a relative link
	 * written beside it still resolves. A second import lands on the same file
	 * again rather than numbering a copy, which would leave those links behind.
	 */
	private async copyAttachment(ctx: ImportContext, parent: string, file: PickedFile): Promise<void> {
		const folder = await this.createFolders(parent || '/');
		const at = folder.path === '/' ? '' : folder.path;

		const name = sanitizeFileName(file.name, at);
		const desired = normalizePath(at ? `${at}/${name}` : name);

		const existing = this.vault.getAbstractFileByPath(desired);
		const reusable = existing instanceof TFile && this.duplicateHandling !== DuplicateHandling.CreateCopy;

		if (reusable && this.duplicateHandling === DuplicateHandling.Skip) {
			ctx.reportSkipped(file.name, i18n.reason.alreadyInVault());
			return;
		}

		const path = !this.hasClaimed(desired) && (existing === null || reusable) ? desired : this.freeFilePath(at, name);
		this.claimPath(path);

		await this.writeAttachment(path, await file.read(), await fileTimes(file));
		ctx.reportAttachmentSuccess(file.name);
	}
}
