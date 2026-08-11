import { normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { helpUrl } from '../constants';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, NoteDisposition, PlannedNote } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { defaultEvernoteOptions } from './evernote/options';
import { convertEnexFiles } from './evernote/convert';
import { parseFilePath } from '../filesystem';
import { availableFileName } from '../util';
import { EvernoteOutput, PlacedAttachment } from './evernote/output';

const HELP_PERMALINK = 'import/evernote';

interface EnexPlan {
	planned: PlannedNote;
	reportAs: string;
	disposition: NoteDisposition;
}

export class EvernoteEnexImporter extends FormatImporter {
	interruption = 'pause' as const;

	init() {
		this.addSetting('source')
			?.setName(i18n.common.nameExport())
			.setDesc(i18n.importer.evernote.descExport())
			.addButton(button => button
				.setButtonText(i18n.common.buttonInstructions())
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting(i18n.importer.evernote.fileType(), ['enex'], true);
		this.defaultOutputFolder = 'Evernote';
	}

	private outputInto(ctx: ImportContext): EvernoteOutput {
		const { vault } = this;
		const plans = new Map<string, EnexPlan>();

		return {
			planFolder: (parent, name) => {
				const at = (candidate: string) => normalizePath(`${parent}/${candidate}`);

				const folder = this.duplicateHandling === DuplicateHandling.CreateCopy
					? at(availableFileName(name, candidate => this.hasClaimed(at(candidate))
						|| vault.getAbstractFileByPathInsensitive(at(candidate)) !== null))
					: folderPath(vault.getAbstractFileByPathInsensitive(at(name))) ?? at(name);

				this.claimPath(folder);

				return folder;
			},

			planNote: (folder, title, reportAs) => {
				const planned = this.planNote(folder, title);
				plans.set(planned.targetPath, { planned, reportAs, disposition: 'create' });

				return planned.targetPath;
			},

			willImport: (path, sourceMtime) => {
				const plan = plans.get(path)!;
				plan.disposition = this.preflightNote(ctx, { ...plan.planned, title: plan.reportAs }, sourceMtime);

				return !leavesTheNoteAlone(plan.disposition);
			},

			writeNote: async (path, markdown, times) => {
				const { planned, reportAs, disposition } = plans.get(path)!;
				await this.createFolders(parseFilePath(path).parent || '/');

				const { written } = await this.writePlannedNote(ctx, planned, markdown, { ...times, disposition });
				if (written) ctx.reportNoteSuccess(reportAs);
			},

			placeAttachment: async (fileName, notePath, size): Promise<PlacedAttachment> => {
				const { path, reuse } = await this.placeAttachment(fileName, notePath,
					existing => existing.stat.size === size ? 'same' : 'another');

				return { path, write: reuse === null };
			},

			linkTo: (path, fromNote) => {
				const file = vault.getAbstractFileByPath(path);

				return file instanceof TFile
					? this.app.metadataCache.fileToLinktext(file, fromNote)
					: path;
			},

			writeAttachment: async (path, data, times) => {
				await this.createFolders(parseFilePath(path).parent || '/');
				const file = await this.writeAttachment(path, data, times);
				ctx.reportAttachmentSuccess(file.name);
			},
		};
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

		await convertEnexFiles({
			...defaultEvernoteOptions,
			enexSources: files,
			outputDir: folder.path,
		}, this.outputInto(ctx), ctx);
	}
}

function folderPath(found: unknown): string | null {
	return found instanceof TFolder ? found.path : null;
}
