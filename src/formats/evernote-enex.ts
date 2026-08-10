import { FileSystemAdapter, normalizePath, Notice } from 'obsidian';
import { helpUrl } from '../constants';
import { path } from '../filesystem';
import { markdownOutputFor } from '../markdown-output';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { ExistingNote, ExistingNoteDecision, setExistingNoteHandler, setMarkdownOutput, setMarkdownTracker } from './evernote/options';
import { defaultEvernoteOptions, convertEnexFiles } from './evernote/convert';

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
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		setMarkdownOutput(markdownOutputFor(app.vault));

		let evernoteOptions = {
			...defaultEvernoteOptions,
			...{
				enexSources: files,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			},
		};

		setMarkdownTracker(absolutePath => {
			this.trackMarkdownFile(normalizePath(path.relative(adapter.getBasePath(), absolutePath)));
		});

		setExistingNoteHandler(this.duplicateHandling === DuplicateHandling.CreateCopy
			? null
			: existing => this.decideExistingNote(existing));

		try {
			await convertEnexFiles(evernoteOptions, ctx);
		}
		finally {
			setMarkdownTracker(null);
			setExistingNoteHandler(null);
		}
	}
}
