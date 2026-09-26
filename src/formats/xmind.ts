import { Notice, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { sanitizeFileName } from '../util';
import { readZip, ZipEntryFile } from '../zip';
import { convertSheet, parseXMindJson, parseXMindXml, XMindData } from './xmind/convert';

export class XMindImporter extends FormatImporter {
	static extensions = ['xmind'];

	interruption = 'pause' as const;

	splitDepth: number = 4;

	init() {
		this.addFileChooserSetting(i18n.importer.xmind.fileType(), XMindImporter.extensions, true);
		this.defaultOutputFolder = 'XMind';

		this.addSetting()
			?.setName(i18n.importer.xmind.nameSplitDepth())
			.setDesc(i18n.importer.xmind.descSplitDepth())
			.addDropdown(dropdown => {
				dropdown
					.addOption('0', i18n.importer.xmind.optionNoSplit())
					.addOption('1', i18n.importer.xmind.optionSplitLevel1())
					.addOption('2', i18n.importer.xmind.optionSplitLevel2())
					.addOption('3', i18n.importer.xmind.optionSplitLevel3())
					.addOption('4', i18n.importer.xmind.optionSplitLevel4())
					.setValue('4')
					.onChange(value => {
						this.splitDepth = parseInt(value);
					});
			});
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		ctx.reportProgress(0, files.length);
		for (let i = 0; i < files.length; i++) {
			if (await ctx.shouldStop()) return;

			const file = files[i];
			ctx.status(i18n.common.statusProcessing({ name: file.name }));

			try {
				await readZip(file, async (_zip, entries) => {
					const data = await parseEntries(entries);
					await this.importSheets(ctx, folder, file.basename, data, entries);
				});
			}
			catch (e) {
				ctx.reportFailed(file.name, e);
			}

			ctx.reportProgress(i + 1, files.length);
		}
	}

	private async importSheets(
		ctx: ImportContext, folder: TFolder, basename: string, data: XMindData, entries: ZipEntryFile[]
	): Promise<void> {
		const multiSheet = data.sheets.length > 1;

		for (const sheet of data.sheets) {
			if (await ctx.shouldStop()) return;

			const sheetName = multiSheet
				? `${basename} - ${sheet.title}`
				: basename;

			const notes = convertSheet(sheet, this.splitDepth);

			if (notes.length === 1) {
				const { written } = await this.writeNote(ctx, folder, sheetName, notes[0].content);
				if (written) ctx.reportNoteSuccess(sheetName);
				await this.extractAttachments(ctx, folder.path, notes[0].attachments, entries);
			}
			else {
				for (const note of notes) {
					if (await ctx.shouldStop()) return;
					const segments = note.path.map(s => sanitizeFileName(s));
					const noteFolderPath = [folder.path, ...segments].join('/');
					const noteFolder = segments.length > 0
						? await this.createFolders(noteFolderPath)
						: folder;
					const { written } = await this.writeNote(ctx, noteFolder, note.title, note.content);
					if (written) ctx.reportNoteSuccess(note.title);
					await this.extractAttachments(ctx, noteFolder.path, note.attachments, entries);
				}
			}
		}
	}

	private async extractAttachments(
		ctx: ImportContext, folderPath: string, attachments: { zipPath: string, filename: string }[], entries: ZipEntryFile[],
	): Promise<void> {
		for (const attachment of attachments) {
			const entry = entries.find(e => e.filepath === attachment.zipPath);
			if (!entry) continue;

			try {
				const data = await entry.read();
				const path = `${folderPath}/${sanitizeFileName(attachment.filename)}`;
				await this.writeAttachment(path, data);
				ctx.reportAttachmentSuccess(path);
			}
			catch (e) {
				ctx.reportFailed(attachment.filename, e);
			}
		}
	}
}

async function parseEntries(entries: ZipEntryFile[]): Promise<XMindData> {
	const jsonEntry = entries.find(e => e.name === 'content.json');
	if (jsonEntry) {
		return parseXMindJson(await jsonEntry.readText());
	}

	const xmlEntry = entries.find(e => e.name === 'content.xml');
	if (xmlEntry) {
		return parseXMindXml(await xmlEntry.readText());
	}

	throw new Error('No content.json or content.xml found in the XMind file');
}
