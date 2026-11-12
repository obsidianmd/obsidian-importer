import { normalizePath, Notice, TFolder } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { PREVIEW_IMAGE_PLACEHOLDER, PreviewImageStore, previewImageMime } from '../preview-image';
import { sameBytes, sanitizeFileName, sanitizeFilePath } from '../util';
import { hiddenZipPath, readZip, ZipEntryFile } from '../zip';
import { convertSamsungNote } from './samsung-notes/convert';
import { imageBindIds, mediaDisplayName, parseSamsungNote, SamsungNote } from './samsung-notes/parse';

interface OpenedNote {
	note: SamsungNote;
	title: string;
	/** Archive entries by path relative to the note's root. */
	files: Map<string, ZipEntryFile>;
}

export class SamsungNotesImporter extends FormatImporter {
	static extensions = ['sdocx', 'zip'];

	interruption = 'pause' as const;

	init() {
		this.addExportSetting(i18n.importer.samsungNotes.descExport());
		this.addFileChooserSetting(i18n.importer.samsungNotes.fileType(), SamsungNotesImporter.extensions, true);
		this.defaultOutputFolder = 'Samsung Notes';
	}

	protected override async templatePreviewSamples(ctx: ImportContext, images: PreviewImageStore): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		await this.eachNoteFile(ctx, async (file, subfolder) => {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT) return false;
			try {
				await this.openNote(file, async opened => {
					const previews = new Map<number, string>();
					for (const bindId of imageBindIds(opened.note.body)) {
						const entry = this.mediaEntry(opened, bindId);
						const mime = entry ? previewImageMime(entry.extension) : undefined;
						previews.set(bindId, entry && mime
							? await images.get(entry.fullpath, mime, () => entry.read(), entry.size)
							: PREVIEW_IMAGE_PLACEHOLDER);
					}

					samples.push({
						title: opened.title,
						path: normalizePath(`${this.outputLocation}/${subfolder}/${opened.title}.md`),
						content: convertSamsungNote(opened.note, { embedImage: bindId => `![](${previews.get(bindId) ?? PREVIEW_IMAGE_PLACEHOLDER})` }),
						times: { ctime: opened.note.ctime, mtime: opened.note.mtime },
					});
				});
			}
			catch (error) {
				console.warn(`Could not preview Samsung Notes file ${file.fullpath}`, error);
			}
			return true;
		});
		return samples;
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

		await this.eachNoteFile(ctx, async (file, subfolder) => {
			try {
				ctx.status(i18n.common.statusImportingNote({ name: file.basename }));
				await this.importNote(ctx, subfolder ? await this.createFolders(`${folder.path}/${subfolder}`) : folder, file);
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
			}
			return true;
		});
	}

	/**
	 * Visit each picked .sdocx file, and each one inside a picked .zip, until the visitor returns false.
	 * A note in a zip gets its folder within the zip, since an export doesn't record its Samsung Notes folder.
	 */
	private async eachNoteFile(ctx: ImportContext, visit: (file: PickedFile, subfolder: string) => Promise<boolean>): Promise<void> {
		for (const file of this.files) {
			if (await ctx.shouldStop()) return;

			if (file.extension === 'sdocx') {
				if (!await visit(file, '')) return;
				continue;
			}

			let keepGoing = true;
			try {
				await readZip(file, async (_zip, entries) => {
					for (const entry of entries) {
						if (!keepGoing || await ctx.shouldStop()) return;
						if (entry.extension === 'sdocx' && !hiddenZipPath(entry.filepath)) keepGoing = await visit(entry, sanitizeFilePath(entry.parent));
					}
				});
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
			}
			if (!keepGoing) return;
		}
	}

	private async openNote(file: PickedFile, use: (opened: OpenedNote) => Promise<void>): Promise<boolean> {
		let found = false;
		await readZip(file, async (_zip, entries) => {
			const noteEntry = entries.find(entry => entry.name === 'note.note');
			if (!noteEntry) return;
			found = true;

			const root = noteEntry.parent ? `${noteEntry.parent}/` : '';
			const files = new Map<string, ZipEntryFile>();
			for (const entry of entries) {
				if (entry.filepath.startsWith(root)) files.set(entry.filepath.slice(root.length), entry);
			}

			const pages = [...files].filter(([path]) => !path.includes('/') && path.endsWith('.page'));
			const note = parseSamsungNote({
				note: await noteEntry.read(),
				mediaInfo: await files.get('media/mediaInfo.dat')?.read(),
				pages: await Promise.all(pages.map(([, entry]) => entry.read())),
			});

			const title = sanitizeFileName(note.title || file.basename);
			await use({ note, title, files });
		});
		return found;
	}

	private mediaEntry(opened: OpenedNote, bindId: number): ZipEntryFile | undefined {
		const filename = opened.note.media.get(bindId);
		return filename === undefined ? undefined : opened.files.get(`media/${filename}`);
	}

	private async importNote(ctx: ImportContext, folder: TFolder, file: PickedFile): Promise<void> {
		const found = await this.openNote(file, async opened => {
			const { note, title } = opened;
			const notePath = normalizePath(`${folder.path}/${title}.md`);

			const images = new Map<number, string>();
			for (const bindId of imageBindIds(note.body)) {
				if (await ctx.shouldStop()) return;
				const entry = this.mediaEntry(opened, bindId);
				if (!entry) {
					ctx.reportSkipped(note.media.get(bindId) ?? String(bindId), i18n.importer.samsungNotes.reasonMissingImage({ name: title }));
					continue;
				}

				try {
					images.set(bindId, await this.importImage(ctx, entry, notePath));
				}
				catch (error) {
					ctx.reportFailed(entry.fullpath, error);
				}
			}

			const content = convertSamsungNote(note, {
				embedImage: bindId => images.has(bindId) ? `![[${images.get(bindId)}]]` : null,
			});
			const { written } = await this.writeNote(ctx, folder, title, content, {
				ctime: note.ctime,
				mtime: note.mtime,
			});
			if (written) ctx.reportNoteSuccess(file.fullpath);
			if (note.unsupportedPages > 0) ctx.reportMessage(i18n.importer.samsungNotes.msgUnsupportedPages({ name: title }));
		});

		if (!found) ctx.reportSkipped(file.fullpath, i18n.importer.samsungNotes.reasonNotSamsungNote());
	}

	private async importImage(ctx: ImportContext, entry: ZipEntryFile, notePath: string): Promise<string> {
		ctx.status(i18n.common.statusImportingAttachment({ name: entry.name }));
		const data = await entry.read();
		const { path, reuse } = await this.placeAttachment(mediaDisplayName(entry.name), notePath, async existing => {
			if (existing.stat.size !== data.byteLength) return 'another';
			return sameBytes(await this.vault.readBinary(existing), data) ? 'same' : 'another';
		});

		if (reuse) {
			ctx.reportSkipped(entry.fullpath, i18n.reason.alreadyInVault());
			return path;
		}

		await this.writeAttachment(path, data);
		ctx.reportAttachmentSuccess(entry.fullpath);
		return path;
	}
}
