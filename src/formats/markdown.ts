import { normalizePath, Notice, TFile } from 'obsidian';
import { fsPromises, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, NoteTemplateSample, PlannedNote, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ImportContext } from '../import-context';
import { ImportedPathIndex, normalizeTreePath, parentTreePath, resolveTreePath } from '../imported-path-index';
import { i18n } from '../i18n';
import { MarkdownFormatting, MarkdownLinkResolver } from '../markdown-output';
import { isHiddenPickedItem, PickedFolderNode, PickedFolderPicker, pickedFolderNodes, plannedPickedItems, PlannedPickedItem } from '../picked-folder-tree';
import { sameBytes } from '../util';
import { withZipContents, ZipEntryFile } from '../zip';
import { convertMarkdownNote } from './markdown/convert';

const MARKDOWN_EXTS = ['md', 'markdown'];

const NATIVE_EXTS = ['base', 'canvas'];

const SOURCE_EXTS = [...MARKDOWN_EXTS, ...NATIVE_EXTS, 'zip'];

interface PlannedItem extends PlannedPickedItem {
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
	private folderPicker: PickedFolderPicker;
	private importedPaths: ImportedPathIndex<TFile>;
	private outputRoot: string;
	private linksNeedRepair: boolean;

	init(): void {
		this.defaultOutputFolder = 'Markdown';
		this.standardizeFormatting = true;
		this.tagsAsProperties = false;
		this.importedPaths = new ImportedPathIndex();
		this.outputRoot = '';
		this.linksNeedRepair = false;
		this.folderPicker = new PickedFolderPicker(
			() => this.source(),
			async (source, isCurrent) => {
				let nodes: PickedFolderNode[] = [];
				await withZipContents(source, async items => {
					nodes = await pickedFolderNodes(items, {
						includeFolder: (folder, chosen) => chosen || !isHiddenPickedItem(folder),
						countFile: file => !isHiddenPickedItem(file) && isMarkdown(file),
						isCurrent,
					});
				});
				return nodes;
			},
		);

		this.keepsFolders = true;
		this.addFileChooserSetting(
			i18n.importer.markdown.fileType(), SOURCE_EXTS, true,
			i18n.importer.markdown.descSource());

		this.draw(contentEl => this.folderPicker.draw(contentEl, this.addSetting('source')), 'source');

		this.addSetting('template')
			?.setName(i18n.importer.markdown.nameStandardizeFormatting())
			.setDesc(i18n.importer.markdown.descStandardizeFormatting())
			.addToggle(toggle => toggle
				.setValue(this.standardizeFormatting)
				.onChange(value => {
					this.standardizeFormatting = value;
					this.templateSettingsChanged();
				}));

		this.addSetting('template')
			?.setName(i18n.importer.markdown.nameTagsAsProperties())
			.setDesc(i18n.importer.markdown.descTagsAsProperties())
			.addToggle(toggle => toggle
				.setValue(this.tagsAsProperties)
				.onChange(value => {
					this.tagsAsProperties = value;
					this.templateSettingsChanged();
				}));
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
		this.folderPicker.changed();
	}

	/** Accept an entire drop so relative links retain their neighboring files. */
	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return files.some(file => SOURCE_EXTS.includes(file.extension)) ? files.length : 0;
	}

	protected drawOutputSettings(contentEl: HTMLElement): void {
		this.addOutputFolderSetting(contentEl);
		this.addDuplicateHandlingSetting(contentEl);
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		await withZipContents(this.source(), async items => {
			const planned = await plannedPickedItems(items, this.outputLocation.trim(), {
				selection: this.folderPicker.selection(),
				includeFile: (file, chosen) => (chosen || !isHiddenPickedItem(file)) && isMarkdown(file),
				includeFolder: (folder, chosen) => chosen || !isHiddenPickedItem(folder),
				folderPath: (folder, parent, chosen) => this.mirroredFolderPath(parent, folder.name, chosen),
				onFolder: () => {},
				shouldStop: () => ctx.shouldStop(),
				onError: (item, error) => ctx.reportFailed(item.name, error),
			});

			for (const item of planned) {
				if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
				if (!item.file || !isMarkdown(item.file)) continue;
				const { markdown } = convertMarkdownNote(await item.file.readText(), {
					tagsAsProperties: this.tagsAsProperties,
				});
				samples.push({
					title: item.file.basename,
					path: normalizePath(`${item.parent}/${item.file.basename}.md`),
					content: markdown,
					times: await fileTimes(item.file),
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

		this.importedPaths.clear();
		this.outputRoot = folder.path === '/' ? '' : folder.path;
		this.linksNeedRepair = false;

		await withZipContents(source, async items => {
			const planned: PlannedItem[] = await plannedPickedItems(items, this.outputRoot, {
				selection: this.folderPicker.selection(),
				includeFile: (file, chosen) => chosen || !isHiddenPickedItem(file),
				includeFolder: (folder, chosen) => chosen || !isHiddenPickedItem(folder),
				folderPath: (folder, parent, chosen) => this.mirroredFolderPath(parent, folder.name, chosen),
				onFolder: (path, chosen) => {
					if (chosen) this.claimPath(path);
				},
				shouldStop: () => ctx.shouldStop(),
				onError: (item, error) => ctx.reportFailed(item.name, error),
			});
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

			item.note = await this.planTemplatedNote(item.parent || '/', file.basename);
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
