import { FileSystemAdapter, normalizePath, Notice } from 'obsidian';
import { helpUrl } from '../constants';
import { path } from '../filesystem';
import { markdownOutputFor } from '../markdown-output';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { setMarkdownOutput, setMarkdownTracker } from './yarle/options';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

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

		// yarle writes its own files rather than through the vault
		setMarkdownOutput(markdownOutputFor(app.vault));

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: files,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			},
		};

		setMarkdownTracker(absolutePath => {
			this.trackMarkdownFile(normalizePath(path.relative(adapter.getBasePath(), absolutePath)));
		});
		try {
			await dropTheRope(yarleOptions, ctx);
		}
		finally {
			setMarkdownTracker(null);
		}
	}
}
