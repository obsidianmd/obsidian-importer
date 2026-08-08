import { Notice } from 'obsidian';
import type { TFolder } from 'obsidian';
import type { PickedFile } from '../filesystem';
import { fs, os, path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import type { ImportContext } from '../import-context';
import { convertJournalEntry } from './apple-journal/convert';

const DEFAULT_OUTPUT_FOLDER = 'Journal';


export class AppleJournalImporter extends FormatImporter {
	interruption = 'pause' as const;

	private frontMatterEnabled = true;

	init(): void {
		const defaultImportPath = detectDefaultEntriesPath();
		this.addFileChooserSetting(
			'Journal entries',
			['htm', 'html'],
			true,
			'Export your entries from the Journal app, then pick the HTML files it wrote to iCloud Drive.',
			defaultImportPath
		);

		this.addSetting()
			?.setName('Journal metadata')
			.setHeading();

		this.addSetting()
			?.setName('Add metadata as frontmatter')
			.setDesc('Capture state-of-mind, contact, and similar tokens in YAML when available.')
			.addToggle(toggle => {
				toggle.setValue(this.frontMatterEnabled);
				toggle.onChange(value => {
					this.frontMatterEnabled = value;
				});
			});


		this.defaultOutputFolder = DEFAULT_OUTPUT_FOLDER;
	}

	async import(ctx: ImportContext): Promise<void> {
		if (this.files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.reportProgress(0, this.files.length);
		for (let index = 0; index < this.files.length; index++) {
			if (await ctx.shouldStop()) return;

			const file = this.files[index];
			if (file.name === 'index.html') {
				ctx.reportSkipped(file.fullpath, 'index file is not a journal entry');
				ctx.reportProgress(index + 1, this.files.length);
				continue;
			}

			try {
				ctx.status(`Importing note ${file.basename}`);
				const imported = await this.importEntry(ctx, folder, file);
				if (imported) {
					ctx.reportNoteSuccess(file.fullpath);
				}
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error);
			}

			ctx.reportProgress(index + 1, this.files.length);
		}
	}

	private async importEntry(ctx: ImportContext, folder: TFolder, file: PickedFile): Promise<boolean> {
		const mdContent = convertJournalEntry(await file.readText(), { frontMatter: this.frontMatterEnabled });

		const { written } = await this.writeNote(ctx, folder, file.basename, mdContent);
		return written;
	}
}

function detectDefaultEntriesPath(): string | undefined {
	if (!fs || !path || !os) {
		return undefined;
	}

	if (os.platform() !== 'darwin') {
		return undefined;
	}

	const candidate = path.join(
		os.homedir(),
		'Library',
		'Mobile Documents',
		'com~apple~CloudDocs',
		'Journal',
		'AppleJournalEntries'
	);

	try {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	catch {
		return undefined;
	}

	return undefined;
}
