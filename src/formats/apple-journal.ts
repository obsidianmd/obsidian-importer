import { normalizePath, Notice } from 'obsidian';
import type { TFolder } from 'obsidian';
import type { PickedFile } from '../filesystem';
import { fs, os, path } from '../filesystem';
import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { i18n } from '../i18n';
import type { ImportContext } from '../import-context';
import { convertJournalEntry } from './apple-journal/convert';

const DEFAULT_OUTPUT_FOLDER = 'Journal';


export class AppleJournalImporter extends FormatImporter {
	static extensions = ['htm', 'html'];

	interruption = 'pause' as const;

	private frontMatterEnabled = true;

	init(): void {
		const defaultImportPath = detectDefaultEntriesPath();
		this.addFileChooserSetting(
			i18n.importer.appleJournal.fileType(),
			AppleJournalImporter.extensions,
			true,
			i18n.importer.appleJournal.descFiles(),
			defaultImportPath
		);

		this.startGroup('template', i18n.importer.appleJournal.headingMetadata());

		this.addSetting('template')
			?.setName(i18n.importer.appleJournal.nameFrontMatter())
			.setDesc(i18n.importer.appleJournal.descFrontMatter())
			.addToggle(toggle => {
				toggle.setValue(this.frontMatterEnabled);
				toggle.onChange(value => {
					this.frontMatterEnabled = value;
					this.templateSettingsChanged();
				});
			});


		this.defaultOutputFolder = DEFAULT_OUTPUT_FOLDER;
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

		ctx.reportProgress(0, this.files.length);
		for (let index = 0; index < this.files.length; index++) {
			if (await ctx.shouldStop()) return;

			const file = this.files[index];
			if (file.name === 'index.html') {
				ctx.reportSkipped(file.fullpath, i18n.importer.appleJournal.reasonIndexFile());
				ctx.reportProgress(index + 1, this.files.length);
				continue;
			}

			try {
				ctx.status(i18n.common.statusImportingNote({ name: file.basename }));
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

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		for (const file of this.files) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			if (file.name === 'index.html') continue;
			try {
				samples.push({
					title: file.basename,
					path: normalizePath(`${this.outputLocation}/${file.basename}.md`),
					content: convertJournalEntry(await file.readText(), { frontMatter: this.frontMatterEnabled }),
				});
			}
			catch (error) {
				console.warn(`Could not preview Apple Journal file ${file.fullpath}`, error);
			}
		}
		return samples;
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
