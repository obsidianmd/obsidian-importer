import { Notice, Platform, TFile, TFolder, normalizePath } from 'obsidian';
import { PickedFile, fs, os, path as nodePath } from '../filesystem';
import { FormatImporter, leavesTheNoteAlone } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { describeReason, extensionFromBytes, sanitizeFileName, uint8arrayToArrayBuffer } from '../util';
import { findBackupFolder } from './onenote-file/backup-folder';
import { convertPage } from './onenote-file/convert';
import { OneNoteErrorKind, OneNoteFormatError } from './onenote-file/errors';
import { isPackage, listSections, readSections } from './onenote-file/package';
import { Page, Section } from './onenote-file/semantic/content';


interface SectionNode extends ViewableNode<SectionNode> {
	file: PickedFile;
	entryName?: string;
}

const REASONS: Record<OneNoteErrorKind, () => string> = {
	unsupported: () => i18n.importer.onenoteFile.reasonUnsupported(),
	protected: () => i18n.importer.onenoteFile.reasonRightsProtected(),
	malformed: () => i18n.importer.onenoteFile.reasonMalformed(),
	limit: () => i18n.importer.onenoteFile.reasonTooLarge(),
};

export class OneNoteFileImporter extends FormatImporter {
	static extensions = ['one', 'onepkg', 'onex'];

	interruption = 'pause' as const;

	// Field initializers would overwrite values set by base-constructor init().
	private picker: TreePicker<SectionNode>;
	private loadedFrom = '';
	private loadGeneration = 0;

	init(): void {
		this.addInstructions(this.addExportSetting(i18n.importer.onenoteFile.descExport()));

		const backup = windowsBackupFolder();
		this.addFileChooserSetting(
			i18n.importer.onenoteFile.fileType(),
			OneNoteFileImporter.extensions,
			true,
			backup ? i18n.importer.onenoteFile.descBackupFolder() : undefined,
			backup);
		this.defaultOutputFolder = 'OneNote';
		this.idProperty = 'onenote-id';
		this.idLabel = i18n.importer.onenoteFile.labelId();

		this.drawSectionPicker();
	}

	protected sourceChanged(): void {
		super.sourceChanged();

		this.showSections();

		const key = this.files.map(file => file.fullpath).join('\n');
		if (key === this.loadedFrom) return;

		this.loadedFrom = key;
		if (this.picker) void this.loadSections();
	}

	/**
	 * The sections are what a file turned out to hold, so there is nothing to
	 * say about them until there is a file: a row telling the user to pick one
	 * repeats the row above it.
	 */
	private showSections(): void {
		this.picker?.toggle(this.files.length > 0);
	}

	private drawSectionPicker(): void {
		this.draw(contentEl => {
			this.picker = new TreePicker<SectionNode>(contentEl, {
				setting: this.addSetting('source'),
				name: i18n.importer.onenoteFile.nameSections(),
				desc: i18n.importer.onenoteFile.descSections(),
				hint: i18n.importer.onenoteFile.msgPickFileFirst(),
				loading: i18n.importer.onenoteFile.msgLoadingSections(),
				empty: i18n.importer.onenoteFile.msgNoSections(),
				failed: describeFailure,
				view: {
					icon: node => node.children?.length ? 'book' : 'file-text',
				},
				loadsItself: true,
			});

			// Drawn again with files already picked: the step is redrawn every
			// time it is returned to.
			this.showSections();
		}, 'source');
	}

	private async loadSections(): Promise<void> {
		if (this.files.length === 0) {
			this.picker.reset();
			return;
		}

		const generation = ++this.loadGeneration;

		await this.picker.load(async () => {
			const nodes: SectionNode[] = [];

			for (const file of this.files) {
				const data = new Uint8Array(await file.read());

				// Ignore a read superseded while it was in progress.
				if (generation !== this.loadGeneration) return this.picker.nodes;

				const sections = listSections(data, file.name);

				if (!isPackage(data)) {
					nodes.push({ title: file.basename, file, selected: true, disabled: false });
					continue;
				}

				nodes.push({
					title: file.basename,
					file,
					selected: true,
					disabled: false,
					children: sections.map(entry => ({
						title: entry.title,
						file,
						entryName: entry.name,
						selected: true,
						disabled: false,
					})),
				});
			}

			return generation === this.loadGeneration ? nodes : this.picker.nodes;
		});
	}

	async import(ctx: ImportContext): Promise<void> {
		if (this.files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		const nodes = this.picker?.nodes ?? [];

		// A missing picker means all sections; an empty selection means none.
		const loaded = nodes.length > 0;
		const chosen = selectedNodes(nodes, node => !node.children?.length);

		for (const file of this.files) {
			if (await ctx.shouldStop()) return;

			const forThisFile = chosen.filter(node => node.file === file);
			if (loaded && forThisFile.length === 0) continue;

			const wanted = loaded
				? new Set(forThisFile.map(node => node.entryName).filter((name): name is string => name !== undefined))
				: undefined;

			try {
				await this.importFile(ctx, file, folder, wanted);
			}
			catch (error) {
				report(ctx, file.name, error);
			}
		}
	}

	private async importFile(ctx: ImportContext, file: PickedFile, folder: TFolder, wanted?: Set<string>): Promise<void> {
		ctx.status(i18n.importer.onenoteFile.statusReadingSection({ name: file.name }));

		const data = new Uint8Array(await file.read());
		const sections = readSections(data, file.name, wanted?.size ? wanted : undefined);
		let done = 0;

		for (const entry of sections) {
			if (await ctx.shouldStop()) return;

			ctx.status(i18n.importer.onenoteFile.statusImportingSection({
				name: entry.title,
				index: ++done,
				total: sections.length,
			}));

			let section: Section;
			try {
				section = entry.read();
			}
			catch (error) {
				report(ctx, entry.title, error);
				continue;
			}

			await this.importSection(ctx, section, entry.title, folder, entry.groups);
		}
	}

	private async importSection(ctx: ImportContext, section: Section, fallbackName: string, folder: TFolder, groups: string[] = []): Promise<void> {
		// A section inside section groups keeps them, as OneNote shows them.
		const within = groups.map(group => sanitizeFileName(group)).join('/');
		const parent = within ? `${folder.path}/${within}` : folder.path;
		const sectionFolder = await this.createFolders(normalizePath(`${parent}/${sanitizeFileName(section.name || fallbackName)}`));

		// Create a page folder only when its first subpage arrives.
		const levels: { folder?: TFolder, path?: string }[] = [{ folder: sectionFolder }];
		let done = 0;

		const folderFor = async (depth: number): Promise<TFolder> => {
			const level = levels[depth];
			level.folder ??= await this.createFolders(normalizePath(level.path!));
			return level.folder;
		};

		for (const page of section.pages) {
			if (await ctx.shouldStop()) return;
			if (page.isDeleted) continue;

			ctx.reportProgress(++done, section.pages.length);

			const depth = Math.min(page.level, levels.length - 1);
			levels.length = depth + 1;

			const target = await folderFor(depth);
			const written = await this.importPage(ctx, page, target);

			levels.push(written ? { path: `${target.path}/${written}` } : { folder: target });
		}
	}

	private async importPage(ctx: ImportContext, page: Page, sectionFolder: TFolder): Promise<string | undefined> {
		const title = sanitizeFileName(page.title);

		try {
			// Preflight before conversion so skipped notes write no attachments.
			const planned = this.planNote(sectionFolder, title, page.id);
			const disposition = this.preflightNote(ctx, planned, page.lastModifiedUtc?.getTime());
			if (leavesTheNoteAlone(disposition)) return title;

			const notePath = planned.targetPath;
			const converted = await convertPage(page, {
				noteName: title,
				isCancelled: () => ctx.isCancelled(),
				resolveInternalLink: pageTitle => sanitizeFileName(pageTitle),
				onSkipped: (name, reason) => ctx.reportSkipped(name, reason === 'no-data'
					? i18n.importer.onenoteFile.reasonNoAttachmentData()
					: i18n.importer.onenoteFile.reasonNotRepresentable()),
				saveAttachment: (bytes, suggested) => this.saveAttachment(ctx, bytes, suggested, notePath),
			});

			const { written } = await this.writePlannedNote(ctx, planned, converted.markdown, {
				sourceId: page.id,
				ctime: page.createdUtc?.getTime(),
				mtime: page.lastModifiedUtc?.getTime(),
				disposition,
			});

			if (written) ctx.reportNoteSuccess(title);
			return title;
		}
		catch (error) {
			ctx.reportFailed(title, error);
			return undefined;
		}
	}

	private async saveAttachment(ctx: ImportContext, bytes: Uint8Array, suggested: string, notePath: string) {
		const data = uint8arrayToArrayBuffer(bytes as Uint8Array<ArrayBuffer>);

		if (!/\.[^.\\/]+$/.test(suggested)) {
			const sniffed = extensionFromBytes(bytes);
			if (sniffed) suggested = `${suggested}.${sniffed}`;
		}

		const { path, reuse } = await this.placeAttachment(suggested, notePath, async (existing: TFile) => {
			if (existing.stat.size !== data.byteLength) return 'another';
			const onDisk = new Uint8Array(await this.vault.readBinary(existing));
			return onDisk.every((byte, index) => byte === bytes[index]) ? 'same' : 'another';
		});

		if (!reuse) {
			await this.writeAttachment(path, data);
			ctx.reportAttachmentSuccess(path);
		}

		return { path: reuse?.path ?? path, name: suggested };
	}
}

function windowsBackupFolder(): string | undefined {
	if (!Platform.isWin || !Platform.isDesktopApp || !fs || !nodePath || !os) return undefined;

	return findBackupFolder({
		root: nodePath.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'OneNote'),
		join: (...parts: string[]) => nodePath.join(...parts),
		list: directory => {
			try {
				return fs.readdirSync(directory);
			}
			catch {
				return undefined;
			}
		},
	});
}

function describeFailure(error: unknown): string {
	return error instanceof OneNoteFormatError ? REASONS[error.kind]() : describeReason(error);
}

function report(ctx: ImportContext, name: string, error: unknown): void {
	const expected = error instanceof OneNoteFormatError && (error.kind === 'protected' || error.kind === 'unsupported');

	if (expected) ctx.reportSkipped(name, describeFailure(error));
	else ctx.reportFailed(name, describeFailure(error));
}
