import { normalizePath, Notice } from 'obsidian';
import { PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { sanitizeFileName } from '../util';

const MAX_NAME_LIST_LENGTH = 300;

const NOTE_EXTS = ['md', 'markdown', 'canvas', 'base'];

interface PlannedCopy {
	parent: string;
	// Null represents an empty folder.
	file: PickedFile | null;
}

export class FilesImporter extends FormatImporter {
	interruption = 'pause' as const;

	// No initializers: the base constructor calls init() first.
	private dropped: (PickedFile | PickedFolder)[] | undefined;
	private showDropped: (() => void) | undefined;

	init(): void {
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

	private copying(): (PickedFile | PickedFolder)[] {
		return this.dropped ?? this.files;
	}

	get sourceReady(): boolean {
		return this.copying().length > 0;
	}

	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return files.length;
	}

	takeDropped(dropped: (PickedFile | PickedFolder)[]): void {
		this.dropped = dropped;
		this.showDropped?.();
		this.sourceChanged();
	}

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

			ctx.status(i18n.common.statusProcessing({ name: file ? file.name : parent }));
			try {
				if (file) await this.copy(ctx, parent, file);
				else await this.createFolders(parent);
			}
			catch (error) {
				ctx.reportFailed(file ? file.fullpath : parent, error);
			}

			ctx.reportProgress(++done, planned.length);
		}
	}

	private async plan(ctx: ImportContext, items: (PickedFile | PickedFolder)[], into: string, dropped = true): Promise<PlannedCopy[]> {
		const planned: PlannedCopy[] = [];

		for (const item of items) {
			try {
				if (item.type === 'file') {
					planned.push({ parent: into, file: item });
					continue;
				}

				const name = sanitizeFileName(item.name, into);

				// Only top-level folders are collision-renamed.
				const at = dropped ? this.freeFilePath(into, name) : normalizePath(into ? `${into}/${name}` : name);
				if (dropped) this.claimPath(at);

				const inside = await this.plan(ctx, await item.list(), at, false);

				planned.push(...inside.length > 0 ? inside : [{ parent: at, file: null }]);
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

		const name = sanitizeFileName(file.name, at);
		const path = this.freeFilePath(at, name);
		this.claimPath(path);

		await this.writeAttachment(path, await file.read());

		if (NOTE_EXTS.includes(file.extension)) ctx.reportNoteSuccess(file.name);
		else ctx.reportAttachmentSuccess(file.name);
	}
}
