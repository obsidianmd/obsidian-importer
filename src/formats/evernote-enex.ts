import { Notice } from 'obsidian';
import { helpUrl } from '../constants';
import { markdownOutputFor } from '../markdown-output';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { defaultEvernoteOptions, ExistingNote, ExistingNoteDecision } from './evernote/options';
import { convertEnexFiles } from './evernote/convert';
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
		const output = new VaultOutput(app, file => this.trackMarkdownFile(file));

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
