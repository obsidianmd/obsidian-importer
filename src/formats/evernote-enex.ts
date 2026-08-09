import { FileSystemAdapter, normalizePath, Notice } from 'obsidian';
import { helpUrl } from '../constants';
import { path } from '../filesystem';
import { markdownOutputFor } from '../markdown-output';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { ExistingNote, ExistingNoteDecision, setExistingNoteHandler, setMarkdownOutput, setMarkdownTracker } from './evernote/options';
import { defaultEvernoteOptions, convertEnexFiles } from './evernote/convert';

const HELP_PERMALINK = 'import/evernote';

export class EvernoteEnexImporter extends FormatImporter {
	interruption = 'stop' as const;

	init() {
		this.addSetting('source')
			?.setName('Export your data')
			.setDesc('Export your notebooks in ENEX format, you will receive one .enex file per notebook.')
			.addButton(button => button
				.setButtonText('Open')
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting('Evernote', ['enex'], true);
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
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
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
