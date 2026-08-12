import { normalizePath, Notice } from 'obsidian';
import { PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { sanitizeFileName } from '../util';

const MAX_NAME_LIST_LENGTH = 300;

/** What a copied file is counted as. Everything else is an attachment. */
const NOTE_EXTS = ['md', 'markdown', 'canvas', 'base'];

/** Where a file is going, decided before any of them are written. */
interface PlannedCopy {
	/** Vault folder, made when the file reaches it. */
	parent: string;
	file: PickedFile;
}

/**
 * The files a drop was carrying, copied into the vault as they are.
 *
 * What the file explorer does with a drop, for a drop the import dialog caught
 * instead: nothing is read or converted, and a folder keeps the shape it had
 * outside. It reads no format, which is why it claims no file types: a drop
 * arrives here when nothing else can make sense of it.
 */
export class FilesImporter extends FormatImporter {
	interruption = 'pause' as const;

	/** Both are set in init() or by a drop, not in a field initializer. */
	private dropped: (PickedFile | PickedFolder)[] | undefined;
	private showDropped: (() => void) | undefined;

	init(): void {
		// A copy has nothing to recognize a file by and nothing to update, so a
		// name already taken is numbered, the way the file explorer numbers it.
		this.duplicateModes = [DuplicateHandling.CreateCopy];
		this.duplicateHandling = DuplicateHandling.CreateCopy;
		this.defaultOutputFolder = '';

		const setting = this.addSetting('source')
			?.setName(i18n.importer.files.nameSource())
			.setDesc(i18n.importer.files.descSource());

		if (!setting) return;

		this.showDropped = () => {
			const files = this.copying();
			if (files.length === 0) {
				setting.setDesc(i18n.importer.files.descSource());
				return;
			}

			let names = files.map(file => file.name).join(', ');
			if (names.length > MAX_NAME_LIST_LENGTH) names = names.substring(0, MAX_NAME_LIST_LENGTH) + '...';

			setting.setDesc(createFragment(frag => {
				if (files.length > 1) {
					frag.createSpan({
						text: i18n.source.msgWillImport({
							files: i18n.nouns.itemWithCount({ count: files.length }),
						}),
					});
					frag.createEl('br');
				}

				frag.createSpan({ cls: 'u-pop', text: names });
			}));
		};

		this.showDropped();
	}

	/** The drop, or the files a scripted import was handed instead. */
	private copying(): (PickedFile | PickedFolder)[] {
		return this.dropped ?? this.files;
	}

	get sourceReady(): boolean {
		return this.copying().length > 0;
	}

	/** A folder is kept whole here: copying it means copying what is inside it. */
	takeDropped(dropped: (PickedFile | PickedFolder)[]): number {
		this.dropped = dropped;
		this.showDropped?.();
		this.sourceChanged();

		return dropped.length;
	}

	/** No attachments of its own to place: every file goes where the drop does. */
	protected drawOutputSettings(contentEl: HTMLElement): void {
		this.addOutputFolderSetting(contentEl);
	}

	async import(ctx: ImportContext): Promise<void> {
		const copying = this.copying();

		if (copying.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickImportLocation());
			return;
		}

		const planned = await this.plan(ctx, copying, folder.path === '/' ? '' : folder.path);

		let done = 0;
		ctx.reportProgress(done, planned.length);

		for (const { parent, file } of planned) {
			if (await ctx.shouldStop()) return;

			ctx.status(i18n.common.statusProcessing({ name: file.name }));
			try {
				await this.copy(ctx, parent, file);
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
			}

			ctx.reportProgress(++done, planned.length);
		}
	}

	/** Where each file is going, with the folders it arrived in rebuilt under the output folder. */
	private async plan(ctx: ImportContext, items: (PickedFile | PickedFolder)[], into: string, dropped = true): Promise<PlannedCopy[]> {
		const planned: PlannedCopy[] = [];

		for (const item of items) {
			try {
				if (item.type === 'file') {
					planned.push({ parent: into, file: item });
					continue;
				}

				const name = sanitizeFileName(item.name, into);

				// A dropped folder whose name the vault already holds is copied
				// beside what is there rather than mixed into it, the way the
				// file explorer takes one. Its own folders are rebuilt inside.
				const at = dropped ? this.freeFilePath(into, name) : normalizePath(into ? `${into}/${name}` : name);
				if (dropped) this.claimPath(at);

				planned.push(...await this.plan(ctx, await item.list(), at, false));
			}
			catch (error) {
				ctx.reportFailed(item.name, error);
			}
		}

		return planned;
	}

	private async copy(ctx: ImportContext, parent: string, file: PickedFile): Promise<void> {
		const folder = await this.createFolders(parent || '/');
		const at = folder.path === '/' ? '' : folder.path;

		const name = sanitizeFileName(file.basename, at) + (file.extension ? `.${file.extension}` : '');
		const path = this.freeFilePath(at, name);
		this.claimPath(path);

		await this.writeAttachment(path, await file.read());

		if (NOTE_EXTS.includes(file.extension)) ctx.reportNoteSuccess(file.name);
		else ctx.reportAttachmentSuccess(file.name);
	}
}
