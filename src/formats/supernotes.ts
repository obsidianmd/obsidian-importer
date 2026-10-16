import { normalizePath, Notice, requestUrl } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { countText, describeReason, extensionFromBytes, extensionFromName, sanitizeFileName } from '../util';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { SupernotesConverter, SupernotesNote, SupernotesParentCard } from './supernotes/convert';
import { parseSupernotesExport, SupernotesCard } from './supernotes/models';

interface ParentNode extends ViewableNode<ParentNode> {
	id: string;
	descendants: number;
	children: ParentNode[];
}

function parentNode(parent: SupernotesParentCard): ParentNode {
	return {
		id: parent.id,
		title: parent.name,
		descendants: parent.descendants,
		selected: false,
		disabled: false,
		collapsed: true,
		children: parent.children.map(parentNode),
	};
}

export class SupernotesImporter extends FormatImporter {
	static extensions = ['json'];

	interruption = 'pause' as const;

	/** Cards whose descendants are folded into their note. Chosen in the picker, or set directly when scripted. */
	mergeInto = new Set<string>();

	// Do not initialize fields set by init(); the base constructor calls it first.
	private picker: TreePicker<ParentNode> | undefined;
	private loadedFrom: string | null;
	private attachmentPaths = new Map<string, string>();

	init() {
		this.addInstructions(this.addExportSetting(i18n.importer.supernotes.descExport()));

		this.addFileChooserSetting(i18n.importer.supernotes.fileType(), SupernotesImporter.extensions, false,
			i18n.importer.supernotes.descFiles());
		this.defaultOutputFolder = 'Supernotes';
		// Uploads gather in one folder, as they do in Supernotes, unless the user chose otherwise.
		this.attachmentLocation = { mode: 'folder', path: 'assets' };
		this.idProperty = 'supernotes-id';
		this.idLabel = i18n.importer.supernotes.labelId();

		this.loadedFrom = null;
		this.drawMergePicker();
	}

	protected override sourceChanged(): void {
		super.sourceChanged();

		this.picker?.toggle(this.files.length > 0);

		const key = this.files.map(file => file.fullpath).join('\n');
		if (key === this.loadedFrom) return;

		this.loadedFrom = key;
		if (this.picker) void this.loadParents();
	}

	/**
	 * Cards in Supernotes are small, and which ones read better as one note is
	 * a card-by-card choice. The picker lists every card with children; ticking
	 * one folds its whole subtree into its note, which is why its descendants
	 * are then disabled.
	 */
	private drawMergePicker(): void {
		this.draw(contentEl => {
			this.picker = new TreePicker<ParentNode>(contentEl, {
				setting: this.addSetting('source'),
				name: i18n.importer.supernotes.nameMerge(),
				desc: i18n.importer.supernotes.descMerge(),
				hint: i18n.importer.supernotes.msgPickFileFirst(),
				loading: i18n.importer.supernotes.msgLoadingCards(),
				empty: i18n.importer.supernotes.msgNoParents(),
				failed: describeReason,
				view: {
					icon: node => node.selected ? 'lucide-layers' : 'lucide-folder',
					flair: node => countText(node.descendants),
				},
				onChange: () => {
					this.mergeInto = new Set(selectedNodes(this.picker?.nodes ?? []).map(node => node.id));
				},
				loadsItself: true,
			});

			this.picker.toggle(this.files.length > 0);
		}, 'source');
	}

	private async loadParents(): Promise<void> {
		const picker = this.picker;
		if (!picker) return;
		if (this.files.length === 0) {
			picker.reset();
			return;
		}

		try {
			await picker.load(async isCurrent => {
				const nodes: ParentNode[] = [];
				for (const file of this.files) {
					const parsed = await this.readCards(file);
					if (!isCurrent()) return [];
					if (!parsed) continue;

					nodes.push(...new SupernotesConverter(parsed.cards).parentCards().map(parentNode));
				}
				return nodes;
			});
		}
		catch (error) {
			console.error('Could not read the Supernotes cards', error);
		}
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		for (const file of this.files) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			try {
				const cards = await this.readCards(file);
				if (!cards) continue;

				const converter = this.newConverter(cards.cards);
				for (const note of converter.planned) {
					if (samples.length >= TEMPLATE_PREVIEW_LIMIT) break;
					samples.push({
						title: note.name,
						path: this.sanitizeFilePath(normalizePath([this.outputLocation, note.folder, `${note.name}.md`].filter(Boolean).join('/'))),
						content: await converter.render(note),
						variables: converter.templateVariables(note),
						sourceId: note.card.data.id,
						times: { ctime: note.ctime, mtime: note.mtime },
					});
				}
			}
			catch (error) {
				console.warn(`Could not preview Supernotes export ${file.fullpath}`, error);
			}
		}
		return samples;
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		this.attachmentPaths.clear();

		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		for (const file of files) {
			if (await ctx.shouldStop()) return;

			let parsed: { cards: SupernotesCard[], dropped: number } | null;
			try {
				parsed = await this.readCards(file);
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
				continue;
			}
			if (!parsed) {
				ctx.reportFailed(file.fullpath, i18n.importer.supernotes.reasonInvalidJson());
				continue;
			}
			if (parsed.dropped > 0) {
				ctx.reportSkipped(file.fullpath, i18n.importer.supernotes.reasonCardsDropped({ count: parsed.dropped }));
			}

			const converter = this.newConverter(parsed.cards);
			const notes = converter.planned;
			ctx.reportProgress(0, notes.length);

			for (let index = 0; index < notes.length; index++) {
				if (await ctx.shouldStop()) return;

				const note = notes[index];
				ctx.status(i18n.common.statusImportingNote({ name: note.name }));
				try {
					await this.importNote(ctx, converter, note, outputFolder.path);
				}
				catch (error) {
					ctx.reportFailed(note.name, error);
				}
				ctx.reportProgress(index + 1, notes.length);
			}
		}
	}

	private async importNote(ctx: ImportContext, converter: SupernotesConverter, note: SupernotesNote, outputPath: string): Promise<void> {
		const folderPath = normalizePath([outputPath, note.folder].filter(Boolean).join('/'));
		const folder = await this.createFolders(folderPath);
		const notePath = normalizePath(`${folderPath}/${note.name}.md`);

		const content = await converter.render(note, {
			resolveAttachment: url => this.downloadUpload(ctx, url, notePath),
		});

		const { written } = await this.writeNote(ctx, folder, note.name, content, {
			sourceId: note.card.data.id,
			ctime: note.ctime,
			mtime: note.mtime,
			templateVariables: converter.templateVariables(note),
		});
		if (written) ctx.reportNoteSuccess(note.name);
	}

	/**
	 * Fetch a file uploaded to Supernotes and place it beside the note, or
	 * null to leave its URL in place.
	 *
	 * Uploads are named with a token unique to the file, so a copy already in
	 * the vault under that name is the same upload from an earlier import. An
	 * upload with no extension in its name is fetched first and named from its
	 * bytes, since Obsidian only embeds a file it can tell the type of.
	 */
	private async downloadUpload(ctx: ImportContext, url: string, notePath: string): Promise<string | null> {
		const known = this.attachmentPaths.get(url);
		if (known !== undefined) return known;

		try {
			let filename = sanitizeFileName(uploadFileName(url));
			let data: ArrayBuffer | null = null;

			if (!extensionFromName(filename)) {
				ctx.status(i18n.common.statusImportingAttachment({ name: filename }));
				data = (await requestUrl(url)).arrayBuffer;
				const extension = extensionFromBytes(new Uint8Array(data));
				if (extension) filename = `${filename}.${extension}`;
			}

			const { path, reuse } = await this.placeAttachment(filename, notePath, () => 'same');

			if (!reuse) {
				if (data === null) {
					ctx.status(i18n.common.statusImportingAttachment({ name: filename }));
					data = (await requestUrl(url)).arrayBuffer;
				}
				await this.writeAttachment(path, data);
				ctx.reportAttachmentSuccess(filename);
			}

			this.attachmentPaths.set(url, path);
			return path;
		}
		catch (error) {
			ctx.reportFailed(url, error);
			return null;
		}
	}

	private async readCards(file: PickedFile): Promise<{ cards: SupernotesCard[], dropped: number } | null> {
		const parsed: unknown = JSON.parse(await file.readText());
		return parseSupernotesExport(parsed);
	}

	private newConverter(cards: SupernotesCard[]): SupernotesConverter {
		return new SupernotesConverter(cards, { mergeInto: this.mergeInto });
	}
}

/** The name an upload was given, from its URL; Supernotes encodes it, sometimes twice. */
export function uploadFileName(url: string): string {
	let name = url.split('/').pop() ?? '';
	for (let attempt = 0; attempt < 2 && /%[0-9A-Fa-f]{2}/.test(name); attempt++) {
		try {
			name = decodeURIComponent(name);
		}
		catch {
			break;
		}
	}
	return name || 'upload';
}
