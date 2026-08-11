import { Notice, TFolder, normalizePath } from 'obsidian';
import { helpUrl } from '../constants';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { sanitizeFileName } from '../util';
import { CabinetEntry, DEFAULT_CABINET_LIMITS, readCabinet, readCabinetIndex } from './onenote-file/cabinet/cabinet';
import { convertPage } from './onenote-file/convert';
import { OneNoteFormatError } from './onenote-file/errors';
import { inspectOnex, isCompoundFile } from './onenote-file/onex';
import { readRevisionStore } from './onenote-file/onestore/revision-store';
import { Section } from './onenote-file/semantic/content';
import { mapSection } from './onenote-file/semantic/map';

const HELP_PERMALINK = 'import/onenote';

interface SectionNode extends ViewableNode<SectionNode> {
	/** Which picked file this section came from. */
	file: PickedFile;
	/** The entry name inside a package, or undefined when the file is one section. */
	entryName?: string;
	selected: boolean;
	disabled: boolean;
}

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

	private drawSectionPicker(): void {
		this.draw(contentEl => {
			this.picker = new TreePicker<SectionNode>(contentEl, {
				name: i18n.importer.onenoteFile.nameSections(),
				desc: i18n.importer.onenoteFile.descSections(),
				hint: i18n.importer.onenoteFile.msgPickFileFirst(),
				loading: i18n.importer.onenoteFile.msgLoadingSections(),
				empty: i18n.importer.onenoteFile.msgNoSections(),
				failed: error => describeFailure(error),
				view: {
					icon: node => node.children?.length ? 'book' : 'file-text',
					flair: () => '',
				},
			});

			this.picker.onLoad(() => void this.loadSections());
		}, 'source');
	}

	/**
	 * Names the sections in each picked file.
	 *
	 * A package lists them in its uncompressed header, so this costs no
	 * decompression however large the notebook is.
	 */
	private async loadSections(): Promise<void> {
		if (this.files.length === 0) {
			new Notice(i18n.importer.onenoteFile.msgPickFileFirst());
			return;
		}

		await this.picker.load(async () => {
			const nodes: SectionNode[] = [];

			for (const file of this.files) {
				if (file.extension.toLowerCase() === 'onepkg') {
					const index = readCabinetIndex(new Uint8Array(await file.read()), DEFAULT_CABINET_LIMITS);
					const sections = index.entries
						.filter(entry => entry.name.toLowerCase().endsWith('.one'))
						.map<SectionNode>(entry => ({
							title: entryTitle(entry.name),
							file,
							entryName: entry.name,
							selected: true,
							disabled: false,
						}));

					nodes.push({ title: file.basename, file, selected: true, disabled: false, children: sections });
					continue;
				}

				nodes.push({ title: file.basename, file, selected: true, disabled: false });
			}

			return nodes;
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

		const chosen = selectedNodes(this.picker.nodes, node => !node.children?.length);
		const wanted = chosen.length > 0 ? chosen : undefined;

		for (const file of this.files) {
			if (await ctx.shouldStop()) return;

			const forThisFile = wanted?.filter(node => node.file === file);
			if (wanted && forThisFile!.length === 0) continue;

			try {
				await this.importFile(ctx, file, folder, forThisFile?.map(node => node.entryName));
			}
			catch (error) {
				ctx.reportFailed(file.name, describeFailure(error));
			}
		}
	}

	private async importFile(ctx: ImportContext, file: PickedFile, folder: TFolder, entryNames?: (string | undefined)[]): Promise<void> {
		ctx.status(i18n.importer.onenoteFile.statusReadingSection({ name: file.name }));

		const data = new Uint8Array(await file.read());

		if (isCompoundFile(data)) {
			const inspection = inspectOnex(data);
			ctx.reportSkipped(file.name, inspection.kind === 'rights-protected'
				? i18n.importer.onenoteFile.reasonRightsProtected()
				: i18n.importer.onenoteFile.reasonUnsupportedContainer());
			return;
		}

		const entries: CabinetEntry[] = file.extension.toLowerCase() === 'onepkg'
			? readCabinet(data, DEFAULT_CABINET_LIMITS, name => {
				if (!name.toLowerCase().endsWith('.one')) return false;
				return !entryNames || entryNames.includes(name);
			})
			: [{ name: file.name, data }];

		for (const [index, entry] of entries.entries()) {
			if (await ctx.shouldStop()) return;

			ctx.status(i18n.importer.onenoteFile.statusImportingSection({
				name: entryTitle(entry.name),
				index: index + 1,
				total: entries.length,
			}));

			let section: Section;
			try {
				section = mapSection(readRevisionStore(entry.data));
			}
			catch (error) {
				ctx.reportFailed(entryTitle(entry.name), describeFailure(error));
				continue;
			}

			await this.importSection(ctx, section, entryTitle(entry.name), folder);
		}
	}

	private async importSection(ctx: ImportContext, section: Section, fallbackName: string, folder: TFolder): Promise<void> {
		const name = sanitizeFileName(section.name || fallbackName) || i18n.importer.onenoteFile.labelUntitledSection();
		const sectionFolder = await this.createFolders(normalizePath(`${folder.path}/${name}`));

		for (const page of section.pages) {
			if (await ctx.shouldStop()) return;
			if (page.isDeleted) continue;

			const title = sanitizeFileName(page.title) || i18n.importer.onenoteFile.labelUntitledPage();
			const notePath = normalizePath(`${sectionFolder.path}/${title}.md`);

			try {
				const converted = await convertPage(page, {
					isCancelled: () => ctx.cancelled,
					onSkipped: assetName => ctx.reportSkipped(assetName, i18n.importer.onenoteFile.reasonNoAttachmentData()),
					saveAttachment: async (bytes, suggested) => {
						const attachmentPath = await this.getAvailablePathForAttachment(sanitizeFileName(suggested), [], notePath);
						await this.vault.createBinary(attachmentPath, toArrayBuffer(bytes));
						ctx.reportAttachmentSuccess(attachmentPath);
						return { path: attachmentPath, name: suggested };
					},
				});

				await this.writeNote(ctx, sectionFolder, title, converted.markdown, {
					ctime: page.createdUtc?.getTime(),
					mtime: page.lastModifiedUtc?.getTime(),
				});

				ctx.reportNoteSuccess(title);
			}
			catch (error) {
				ctx.reportFailed(title, describeFailure(error));
			}
		}
	}
}

function entryTitle(name: string): string {
	return name.replace(/^.*[\\/]/, '').replace(/\.one$/i, '');
}

/** A format error carries a code; anything else is passed through as it came. */
function describeFailure(error: unknown): string {
	if (!(error instanceof OneNoteFormatError)) return String(error instanceof Error ? error.message : error);

	if (error.code === 'ONENOTE_NOT_REVISION_STORE') return i18n.importer.onenoteFile.reasonModernPackaging();
	return i18n.importer.onenoteFile.reasonUnreadableSection({ code: error.code });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
