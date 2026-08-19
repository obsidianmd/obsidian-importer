import { normalizePath, Notice, Platform, TFile } from 'obsidian';
import { fsPromises, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { sanitizeFileName } from '../util';
import { convertMarkdownNote } from './markdown/convert';

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
	static extensions = MARKDOWN_EXTS;

	interruption = 'pause' as const;

	// No initializers: the base constructor calls init() first.
	tagsAsProperties: boolean;

	init(): void {
		this.defaultOutputFolder = 'Markdown';
		this.tagsAsProperties = false;

		// A folder is what the structure is read from, so it is kept as one.
		this.keepsFolders = true;
		this.addFileChooserSetting(
			i18n.importer.markdown.fileType(), MARKDOWN_EXTS, true,
			Platform.isDesktopApp ? i18n.importer.markdown.descSource() : undefined);

		this.addSetting()
			?.setName(i18n.importer.markdown.nameTagsAsProperties())
			.setDesc(i18n.importer.markdown.descTagsAsProperties())
			.addToggle(toggle => toggle
				.setValue(this.tagsAsProperties)
				.onChange(value => this.tagsAsProperties = value));
	}

	/** What was chosen or dropped, or the files a scripted import was handed. */
	private source(): (PickedFile | PickedFolder)[] {
		return this.chosen.length > 0 ? this.chosen : this.files;
	}

	/**
	 * A folder comes whole, so what is dropped with a note in it is all taken:
	 * the files beside a note are what its links point at.
	 */
	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return files.some(isMarkdown) ? files.length : 0;
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
	): Promise<PlannedItem[]> {
		const planned: PlannedItem[] = [];

		for (const item of items) {
			try {
				if (item.type === 'file') {
					planned.push({ parent: into, file: item });
					continue;
				}

				const name = sanitizeFileName(item.name, into);

				const at = chosen && this.duplicateHandling === DuplicateHandling.CreateCopy
					? this.freeFilePath(into, name)
					: normalizePath(into ? `${into}/${name}` : name);
				if (chosen) this.claimPath(at);

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
