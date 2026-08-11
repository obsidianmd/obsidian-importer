import { Notice } from 'obsidian';
import { helpUrl } from '../constants';
import { markdownOutputFor } from '../markdown-output';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { defaultEvernoteOptions, ExistingNote, ExistingNoteDecision } from './evernote/options';
import { convertEnexFiles } from './evernote/convert';
import { PlacedAttachment } from './evernote/output';
import { VaultOutput } from './evernote/output-vault';

const HELP_PERMALINK = 'import/evernote';

export class EvernoteEnexImporter extends FormatImporter {
	interruption = 'stop' as const;

	init() {
		this.addSetting('source')
			?.setName(i18n.common.nameExport())
			.setDesc(i18n.importer.evernote.descExport())
			.addButton(button => button
				.setButtonText(i18n.common.buttonOpen())
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting(i18n.importer.evernote.fileType(), ['enex'], true);
		this.defaultOutputFolder = 'Evernote';
	}

	/**
	 * Where an attachment goes, and whether it has to be written.
	 *
	 * An enex says nothing about an attachment that a later export would say
	 * again, so the file itself is all a second import has to go on: the same
	 * name holding the same number of bytes is taken to be this attachment
	 * again, and any other file of that name belongs to something else and is
	 * passed over. This is what Airtable's attachments do, for the same reason.
	 */
	private async placeEnexAttachment(fileName: string, notePath: string, size: number): Promise<PlacedAttachment> {
		const { path, reuse } = await this.placeAttachment(fileName, notePath,
			existing => existing.stat.size === size ? 'same' : 'another');

		return { path, write: reuse === null };
	}

	private decideExistingNote({ writtenAt, updatedAt }: ExistingNote): ExistingNoteDecision {
		if (this.duplicateHandling === DuplicateHandling.Skip) return 'skip';

		if (updatedAt === null) return 'write';

		if (Math.floor(writtenAt) === Math.floor(updatedAt)) return 'skip';

		return writtenAt > updatedAt ? 'skip' : 'write';
	}

	async import(ctx: ImportContext) {
		let { files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		let { app } = this;
		const output = new VaultOutput(
			app,
			file => this.trackMarkdownFile(file),
			(fileName, notePath, size) => this.placeEnexAttachment(fileName, notePath, size),
		);

		await convertEnexFiles({
			...defaultEvernoteOptions,
			enexSources: files,
			outputDir: folder.path,
			markdownOutput: markdownOutputFor(app.vault),
			decideExistingNote: this.duplicateHandling === DuplicateHandling.CreateCopy
				? undefined
				: existing => this.decideExistingNote(existing),
		}, output, ctx);
	}
}
