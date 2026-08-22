import { Notice, TFolder } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter, NoteTemplateSample, NoteWritten, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ATTACHMENT_EXTS } from '../constants';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { readZip, ZipEntryFile } from '../zip';
import { KeepJson } from './keep/models';
import { convertKeepNote } from './keep/convert';



const BUNDLE_EXTS = ['zip'];
const NOTE_EXTS = ['json'];
// Ignore the following files:
// - Html duplicates
// - Another html summary
// - A text file with labels summary
const ZIP_IGNORED_EXTS = ['html', 'txt'];

export class KeepImporter extends FormatImporter {
	// Attachments are accepted by the picker but do not identify a Keep export.
	static extensions = [...BUNDLE_EXTS, ...NOTE_EXTS];

	interruption = 'pause' as const;

	importArchived: boolean = false;
	importTrashed: boolean = false;
	private attachmentPaths = new Map<string, string>();
	private claimedAttachmentPaths: string[] = [];

	init() {
		this.addExportSetting(i18n.importer.keep.descExport())
			?.addButton(button => button
				.setButtonText(i18n.common.buttonOpen())
				.setCta()
				.onClick(() => window.open('https://takeout.google.com/settings/takeout')));

		this.addFileChooserSetting(i18n.importer.keep.fileType(), [...KeepImporter.extensions, ...ATTACHMENT_EXTS], true);

		this.addSetting()
			?.setName(i18n.importer.keep.nameArchived())
			.setDesc(i18n.importer.keep.descArchived())
			.addToggle(toggle => {
				toggle.setValue(this.importArchived);
				toggle.onChange(async (value) => {
					this.importArchived = value;
				});
			});

		this.addSetting()
			?.setName(i18n.importer.keep.nameDeleted())
			.setDesc(i18n.importer.keep.descDeleted())
			.addToggle(toggle => {
				toggle.setValue(this.importTrashed);
				toggle.onChange(async (value) => {
					this.importTrashed = value;
				});
			});

		this.defaultOutputFolder = 'Google Keep';

	}

	async import(ctx: ImportContext): Promise<void> {
		let { files } = this;

		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickImportLocation());
			return;
		}
		await this.handleFiles(files, folder, ctx);
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		const addFile = async (file: PickedFile): Promise<void> => {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || file.extension !== 'json') return;
			try {
				const note = JSON.parse(await file.readText()) as KeepJson;
				if (!note?.userEditedTimestampUsec || !note.createdTimestampUsec) return;
				if (note.isArchived && !this.importArchived) return;
				if (note.isTrashed && !this.importTrashed) return;

				const strictLineBreaks = this.vault.getConfig('strictLineBreaks') === true;
				const { content, ctime, mtime } = convertKeepNote(
					note,
					file.basename,
					strictLineBreaks,
					sourcePath => sourcePath,
				);
				samples.push({
					title: file.basename,
					path: this.sanitizeFilePath(`${this.outputLocation}/${file.basename}.md`),
					content,
					variables: { ...note },
					times: { ctime, mtime },
				});
			}
			catch (error) {
				console.warn(`Could not preview Google Keep file ${file.fullpath}`, error);
			}
		};

		for (const file of this.files) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			if (file.extension === 'zip') {
				await readZip(file, async (_zip, entries) => {
					for (const entry of entries) {
						if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
						await addFile(entry);
					}
				});
			}
			else {
				await addFile(file);
			}
		}
		return samples;
	}

	async handleFiles(files: PickedFile[], folder: TFolder, ctx: ImportContext): Promise<void> {
		// Attachments first, so note links can point at their final collision-free paths.
		for (const file of files) {
			if (await ctx.shouldStop()) return;
			if (!ATTACHMENT_EXTS.contains(file.extension)) continue;
			try {
				await this.importAttachment(file, folder, ctx);
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
			}
		}

		for (const file of files) {
			if (await ctx.shouldStop()) return;
			if (!ATTACHMENT_EXTS.contains(file.extension)) await this.handleFile(file, folder, ctx);
		}
	}

	async handleFile(file: PickedFile, folder: TFolder, ctx: ImportContext) {
		let { fullpath, name, extension } = file;
		ctx.status(i18n.common.statusProcessing({ name }));
		try {
			if (extension === 'zip') {
				await this.readZipEntries(file, folder, ctx);
			}
			else if (extension === 'json') {
				await this.importKeepNote(file, folder, ctx);
			}
			// Don't mention skipped files when parsing zips, because
			else if (!(file instanceof ZipEntryFile) && !ZIP_IGNORED_EXTS.contains(extension)) {
				ctx.reportSkipped(fullpath);
			}
		}
		catch (e) {
			ctx.reportFailed(fullpath, e);
		}
	}

	async readZipEntries(file: PickedFile, folder: TFolder, ctx: ImportContext) {
		await readZip(file, async (zip, entries) => {
			await this.handleFiles(entries, folder, ctx);
		});
	}

	async importKeepNote(file: PickedFile, folder: TFolder, ctx: ImportContext) {
		let { fullpath, basename } = file;
		ctx.status(i18n.common.statusImportingNote({ name: basename }));

		let content = await file.readText();

		const keepJson = JSON.parse(content) as KeepJson;
		if (!keepJson || !keepJson.userEditedTimestampUsec || !keepJson.createdTimestampUsec) {
			ctx.reportFailed(fullpath, i18n.importer.keep.reasonInvalidJson());
			return;
		}
		if (keepJson.isArchived && !this.importArchived) {
			ctx.reportSkipped(fullpath, i18n.importer.keep.reasonArchived());
			return;
		}
		if (keepJson.isTrashed && !this.importTrashed) {
			ctx.reportSkipped(fullpath, i18n.importer.keep.reasonDeleted());
			return;
		}

		const { written } = await this.convertKeepJson(ctx, keepJson, folder, basename);
		if (written) ctx.reportNoteSuccess(fullpath);
	}

	async importAttachment(file: PickedFile, folder: TFolder, ctx: ImportContext): Promise<void> {
		ctx.status(i18n.common.statusImportingAttachment({ name: file.name }));
		const notePath = `${folder.path}/Keep.md`;
		const outputPath = await this.getAvailablePathForAttachment(file.name, this.claimedAttachmentPaths, notePath);
		this.claimedAttachmentPaths.push(outputPath);
		await this.vault.createBinary(outputPath, await file.read());
		this.attachmentPaths.set(file.name, outputPath);
		this.attachmentPaths.set(file.fullpath, outputPath);
		ctx.reportAttachmentSuccess(file.fullpath);
	}

	async convertKeepJson(ctx: ImportContext, keepJson: KeepJson, folder: TFolder, filename: string): Promise<NoteWritten> {
		const strictLineBreaks = this.vault.getConfig('strictLineBreaks') === true;
		const { content, ctime, mtime } = convertKeepNote(
			keepJson,
			filename,
			strictLineBreaks,
			sourcePath => this.attachmentPaths.get(sourcePath) ?? this.attachmentPaths.get(sourcePath.split('/').pop() ?? '') ?? sourcePath
		);
		return await this.writeNote(ctx, folder, filename, content, {
			ctime,
			mtime,
			templateVariables: { ...keepJson },
		});
	}
}
