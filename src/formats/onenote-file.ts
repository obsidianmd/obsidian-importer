import { Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { helpUrl } from '../constants';
import { PickedFile } from '../filesystem';
import { FormatImporter, leavesTheNoteAlone } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { describeReason, extensionFromBytes, sanitizeFileName, uint8arrayToArrayBuffer } from '../util';
import { convertPage } from './onenote-file/convert';
import { OneNoteErrorKind, OneNoteFormatError } from './onenote-file/errors';
import { isPackage, listSections, readSections } from './onenote-file/package';
import { Page, Section } from './onenote-file/semantic/content';

const HELP_PERMALINK = 'import/onenote';

interface SectionNode extends ViewableNode<SectionNode> {
	/** Which picked file this section came from. */
	file: PickedFile;
	/** The entry name inside a package; a whole file has none. */
	entryName?: string;
}

/** One reason per kind, so a new error code cannot arrive without a sentence. */
const REASONS: Record<OneNoteErrorKind, () => string> = {
	unsupported: () => i18n.importer.onenoteFile.reasonUnsupported(),
	protected: () => i18n.importer.onenoteFile.reasonRightsProtected(),
	malformed: () => i18n.importer.onenoteFile.reasonMalformed(),
	limit: () => i18n.importer.onenoteFile.reasonTooLarge(),
};

/**
 * Imports OneNote's own export files, without a Microsoft account.
 *
 * The conversion lives under onenote-file/ and takes no vault: this half picks
 * the files, lets the user choose sections, and writes what comes back.
 */
export class OneNoteFileImporter extends FormatImporter {
	interruption = 'pause' as const;

	// Do not initialize fields set by init(); the base constructor calls it first.
	private picker: TreePicker<SectionNode>;
	/** The files the picker's rows were built from, so a change is noticeable. */
	private loadedFrom = '';
	/** Which load is the current one; an older one that finishes late is dropped. */
	private loadGeneration = 0;

	init(): void {
		this.addSetting('source')
			?.setName(i18n.common.nameExport())
			.setDesc(i18n.importer.onenoteFile.descExport())
			.addButton(button => button
				.setButtonText(i18n.common.buttonOpen())
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting(i18n.importer.onenoteFile.fileType(), ['one', 'onepkg', 'onex'], true);
		this.defaultOutputFolder = 'OneNote';
		this.idProperty = 'onenote-id';
		this.idLabel = i18n.importer.onenoteFile.labelId();

		this.drawSectionPicker();
	}

	/**
	 * The sections come from the picked files themselves, and cost nothing to
	 * read, so they are listed as soon as the files are chosen rather than
	 * behind a button.
	 */
	protected sourceChanged(): void {
		super.sourceChanged();

		const key = this.files.map(file => file.fullpath).join('\n');
		if (key === this.loadedFrom) return;

		this.loadedFrom = key;
		if (this.picker) void this.loadSections();
	}

	private drawSectionPicker(): void {
		this.draw(contentEl => {
			this.picker = new TreePicker<SectionNode>(contentEl, {
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

				// Reading a large package takes long enough for the chosen
				// files to have changed underneath. Checked after the read,
				// because that is what the newer load overtakes us during.
				if (generation !== this.loadGeneration) return this.picker.nodes;

				const sections = listSections(data, file.name);

				// A file that is one section is its own row, not a group of one.
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

		// An import driven by a script has no picker at all, and wants everything.
		const nodes = this.picker?.nodes ?? [];

		// Nothing listed means every section; listed and cleared means none.
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

			await this.importSection(ctx, section, entry.title, folder);
		}
	}

	private async importSection(ctx: ImportContext, section: Section, fallbackName: string, folder: TFolder): Promise<void> {
		const sectionFolder = await this.createFolders(normalizePath(`${folder.path}/${sanitizeFileName(section.name || fallbackName)}`));

		// A subpage belongs under the page above it, as it does in OneNote —
		// which also keeps two subpages of the same name from colliding.
		const parents: TFolder[] = [sectionFolder];
		let done = 0;

		for (const page of section.pages) {
			if (await ctx.shouldStop()) return;
			if (page.isDeleted) continue;

			ctx.reportProgress(++done, section.pages.length);

			const depth = Math.min(page.level, parents.length - 1);
			const target = parents[depth];
			const written = await this.importPage(ctx, page, target);

			// The folder this page's own subpages go in, named after it.
			parents.length = depth + 1;
			parents.push(written
				? await this.createFolders(normalizePath(`${target.path}/${written}`))
				: target);
		}
	}

	/** The note's base name, so its subpages can be filed beneath it. */
	private async importPage(ctx: ImportContext, page: Page, sectionFolder: TFolder): Promise<string | undefined> {
		const title = sanitizeFileName(page.title);

		try {
			// Decided before the page is converted: converting writes its
			// attachments, and a note that is left alone should leave none
			// behind. preflightNote has already reported why.
			const planned = this.planNote(sectionFolder, title, page.id);
			const disposition = this.preflightNote(ctx, planned, page.lastModifiedUtc?.getTime());
			if (leavesTheNoteAlone(disposition)) return title;

			const notePath = planned.targetPath;
			const converted = await convertPage(page, {
				isCancelled: () => ctx.isCancelled(),
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

	/**
	 * The bytes came out of the file being imported, so an attachment already
	 * in the vault can be compared against them outright — which is what lets a
	 * second import reuse the picture instead of writing another copy.
	 */
	private async saveAttachment(ctx: ImportContext, bytes: Uint8Array, suggested: string, notePath: string) {
		const data = uint8arrayToArrayBuffer(bytes as Uint8Array<ArrayBuffer>);

		// Neither a name nor a recorded extension: the bytes are the last word.
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

/** A format error is answered by kind; anything else is described as it came. */
function describeFailure(error: unknown): string {
	return error instanceof OneNoteFormatError ? REASONS[error.kind]() : describeReason(error);
}

/**
 * A file this importer cannot open is skipped, not failed: nothing went wrong
 * with the import, and a rights-protected notebook is not something a retry
 * would fix. Only a file that claims to be OneNote and is not gets reported as
 * a failure.
 */
function report(ctx: ImportContext, name: string, error: unknown): void {
	const expected = error instanceof OneNoteFormatError && (error.kind === 'protected' || error.kind === 'unsupported');

	if (expected) ctx.reportSkipped(name, describeFailure(error));
	else ctx.reportFailed(name, describeFailure(error));
}
