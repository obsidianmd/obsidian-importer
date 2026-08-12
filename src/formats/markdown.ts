import { normalizePath, Notice, Platform, TFile } from 'obsidian';
import { fsPromises, NodePickedFile, NodePickedFolder, PickedFile, PickedFolder, WebPickedFile } from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { sanitizeFileName } from '../util';
import { convertMarkdownNote } from './markdown/convert';

const MAX_NAME_LIST_LENGTH = 300;

const MARKDOWN_EXTS = ['md', 'markdown'];

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

async function fileTimes(file: PickedFile): Promise<FileTimes | undefined> {
	if (!(file instanceof NodePickedFile)) return undefined;

	try {
		const stat = await fsPromises.stat(file.filepath);
		return { ctime: stat.birthtimeMs || stat.ctimeMs, mtime: stat.mtimeMs };
	}
	catch {
		return undefined;
	}
}

export class MarkdownImporter extends FormatImporter {
	static extensions = MARKDOWN_EXTS;

	interruption = 'pause' as const;

	// No initializers: the base constructor calls init() first.
	tagsAsProperties: boolean;
	private picked: (PickedFile | PickedFolder)[] | undefined;
	private showPicked: (() => void) | undefined;

	init(): void {
		this.defaultOutputFolder = 'Markdown';
		this.tagsAsProperties = false;

		this.addSourceSetting();

		this.addSetting()
			?.setName(i18n.importer.markdown.nameTagsAsProperties())
			.setDesc(i18n.importer.markdown.descTagsAsProperties())
			.addToggle(toggle => toggle
				.setValue(this.tagsAsProperties)
				.onChange(value => this.tagsAsProperties = value));
	}

	private addSourceSetting(): void {
		const setting = this.addSetting('source')
			?.setName(i18n.source.name())
			.setDesc(i18n.importer.markdown.descSource());

		if (!setting) return;

		this.showPicked = () => {
			const source = this.source();
			if (source.length === 0) {
				setting.setDesc(i18n.importer.markdown.descSource());
				return;
			}

			let names = source.map(item => item.name).join(', ');
			if (names.length > MAX_NAME_LIST_LENGTH) names = names.substring(0, MAX_NAME_LIST_LENGTH) + '...';

			setting.setDesc(createFragment(frag => {
				if (source.length > 1) {
					frag.createSpan({
						text: i18n.source.msgWillImport({
							files: i18n.nouns.itemWithCount({ count: source.length }),
						}),
					});
					frag.createEl('br');
				}

				frag.createSpan({ cls: 'u-pop', text: names });
			}));
		};

		setting.addButton(button => button
			.setButtonText(i18n.source.buttonChooseFiles())
			.onClick(() => this.chooseFiles()));

		if (Platform.isDesktopApp) {
			setting.addButton(button => button
				.setButtonText(i18n.source.buttonChooseFolders())
				.onClick(() => this.chooseFolders()));
		}

		this.showPicked();
	}

	private chooseFiles(): void {
		if (!Platform.isDesktopApp) {
			const inputEl = createEl('input');
			inputEl.type = 'file';
			inputEl.multiple = true;
			inputEl.accept = MARKDOWN_EXTS.map(extension => '.' + extension).join(',');
			inputEl.addEventListener('change', () => {
				const chosen = Array.from(inputEl.files ?? [])
					.map(file => new WebPickedFile(file))
					.filter(isMarkdown);

				if (chosen.length > 0) this.take(chosen);
			});
			inputEl.click();
			return;
		}

		const filepaths = this.chooseFrom({
			title: i18n.source.dialogPickFiles(),
			properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
			filters: [{ name: i18n.importer.markdown.fileType(), extensions: MARKDOWN_EXTS }],
		});

		if (filepaths.length > 0) this.take(filepaths.map(filepath => new NodePickedFile(filepath)));
	}

	private chooseFolders(): void {
		const filepaths = this.chooseFrom({
			title: i18n.source.dialogPickFolders(),
			properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
		});

		if (filepaths.length > 0) this.take(filepaths.map(filepath => new NodePickedFolder(filepath)));
	}

	private take(source: (PickedFile | PickedFolder)[]): void {
		this.picked = source;
		this.showPicked?.();
		this.sourceChanged();
	}

	/** What was picked or dropped, or the files a scripted import was handed. */
	private source(): (PickedFile | PickedFolder)[] {
		return this.picked ?? this.files;
	}

	get sourceReady(): boolean {
		return this.source().length > 0;
	}

	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return files.filter(isMarkdown).length;
	}

	takeDropped(dropped: (PickedFile | PickedFolder)[]): number {
		this.take(dropped);

		return dropped.length;
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

		const planned = await this.plan(ctx, source, folder.path === '/' ? '' : folder.path);

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
	}

	/**
	 * Where every picked item is going, with the folders it came in preserved.
	 *
	 * A picked folder keeps the name it had, so that importing it a second time
	 * lands on the same notes and can update them. Only asking for a copy each
	 * time numbers the folder instead - which is also what keeps two sources
	 * that happen to share a folder name apart.
	 */
	private async plan(
		ctx: ImportContext,
		items: (PickedFile | PickedFolder)[],
		into: string,
		picked = true,
	): Promise<PlannedItem[]> {
		const planned: PlannedItem[] = [];

		for (const item of items) {
			try {
				if (item.type === 'file') {
					planned.push({ parent: into, file: item });
					continue;
				}

				const name = sanitizeFileName(item.name, into);

				const at = picked && this.duplicateHandling === DuplicateHandling.CreateCopy
					? this.freeFilePath(into, name)
					: normalizePath(into ? `${into}/${name}` : name);
				if (picked) this.claimPath(at);

				const inside = await this.plan(ctx, await item.list(), at, false);

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
