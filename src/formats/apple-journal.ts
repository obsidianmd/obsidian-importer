import { normalizePath, Notice, TFile } from 'obsidian';
import type { TFolder } from 'obsidian';
import type { PickedFile } from '../filesystem';
import { fs, os, path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import type { ImportContext } from '../import-context';
import { sanitizeFileName } from '../util';
import { convertJournalEntry } from './apple-journal/convert';

const DEFAULT_OUTPUT_FOLDER = 'Journal';


const DUPLICATE_HANDLING = {
	Skip: 'skip',
	ImportUpdated: 'import-updated',
	CreateCopy: 'create-copy',
} as const;

type DuplicateHandling = (typeof DUPLICATE_HANDLING)[keyof typeof DUPLICATE_HANDLING];
const DEFAULT_DUPLICATE_HANDLING = DUPLICATE_HANDLING.ImportUpdated;

export class AppleJournalImporter extends FormatImporter {
	private frontMatterEnabled = true;
	private duplicateHandling: DuplicateHandling = DEFAULT_DUPLICATE_HANDLING;

	init(): void {
		const defaultImportPath = detectDefaultEntriesPath();
		this.addFileChooserSetting(
			'Journal entries',
			['htm', 'html'],
			true,
			'Pick the Journal app exported folder',
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

		this.addSetting()
			?.setName('Handle duplicate files')
			.setDesc('How to handle entries that already exist in the vault.')
			.addDropdown(dropdown => {
				dropdown
					.addOption(DUPLICATE_HANDLING.Skip, 'Skip import')
					.addOption(DUPLICATE_HANDLING.ImportUpdated, 'Import only updated')
					.addOption(DUPLICATE_HANDLING.CreateCopy, 'Create a copy')
					.setValue(DEFAULT_DUPLICATE_HANDLING)
					.onChange(value => {
						this.duplicateHandling = value as DuplicateHandling;
					});
			});

		this.addOutputLocationSetting(DEFAULT_OUTPUT_FOLDER);
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
			if (ctx.isCancelled()) return;

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

		const sanitizedName = sanitizeFileName(file.basename);
		const folderPath = folder.path === '/' ? '' : folder.path;
		const fullPath = normalizePath(path.join(folderPath, sanitizedName + '.md'));
		const existingFile = this.vault.getAbstractFileByPath(fullPath)
			?? this.vault.getAbstractFileByPathInsensitive(fullPath);

		if (this.duplicateHandling === DUPLICATE_HANDLING.CreateCopy) {
			await this.saveAsMarkdownFile(folder, file.basename, mdContent);
			return true;
		}

		if (existingFile instanceof TFile) {
			if (this.duplicateHandling === DUPLICATE_HANDLING.Skip) {
				ctx.reportSkipped(file.fullpath, 'file already exists');
				return false;
			}

			if (this.duplicateHandling === DUPLICATE_HANDLING.ImportUpdated) {
				const existingContent = await this.vault.read(existingFile);
				if (existingContent === mdContent) {
					ctx.reportSkipped(file.fullpath, 'journal entry unchanged since last import');
					return false;
				}
			}

			await this.vault.modify(existingFile, mdContent);
			return true;
		}

		await this.vault.create(fullPath, mdContent);
		return true;
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
