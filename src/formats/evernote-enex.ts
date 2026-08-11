import { Notice, TFile } from 'obsidian';
import { helpUrl } from '../constants';
import { markdownOutputFor } from '../markdown-output';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, NoteDisposition, PlannedNote } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { defaultEvernoteOptions } from './evernote/options';
import { convertEnexFiles } from './evernote/convert';
import { EvernoteOutput, PlacedAttachment } from './evernote/output';

const HELP_PERMALINK = 'import/evernote';

/** A note the conversion has planned, kept until the commit writes it. */
interface EnexPlan {
	planned: PlannedNote;
	/** How the note is named in what the import reports. */
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
				.setButtonText(i18n.common.buttonOpen())
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting(i18n.importer.evernote.fileType(), ['enex'], true);
		this.defaultOutputFolder = 'Evernote';
	}

	/**
	 * The vault, answering for the conversion.
	 *
	 * Everything here needs something the conversion has no business holding -
	 * the vault, the duplicate setting, the shared planning - which is why it
	 * is built on this side of the seam rather than handed in.
	 */
	private outputInto(ctx: ImportContext): EvernoteOutput {
		const { vault } = this;
		const plans = new Map<string, EnexPlan>();

		return {
			exists: path => vault.getAbstractFileByPathInsensitive(path) !== null,

			makesCopies: () => this.duplicateHandling === DuplicateHandling.CreateCopy,

			planNote: (folder, title, reportAs) => {
				const planned = this.planNote(folder, title);
				plans.set(planned.targetPath, { planned, reportAs, disposition: 'create' });

				return planned.targetPath;
			},

			willImport: (path, sourceMtime) => {
				const plan = plans.get(path)!;
				// The reported name carries the notebook, which the file name
				// cannot; preflightNote only ever reads the title to report it.
				plan.disposition = this.preflightNote(ctx, { ...plan.planned, title: plan.reportAs }, sourceMtime);

				return !leavesTheNoteAlone(plan.disposition);
			},

			writeNote: async (path, markdown, times) => {
				const { planned, reportAs, disposition } = plans.get(path)!;
				// Vault will not create a file inside a folder that is not there,
				// and nothing has made the notebook's folder: planNote settles a
				// path without creating anything on the way to it.
				await this.createFolders(parentOf(path));

				const { written } = await this.writePlannedNote(ctx, planned, markdown, { ...times, disposition });
				if (written) ctx.reportNoteSuccess(reportAs);
			},

			/**
			 * An enex says nothing about an attachment that a later export would
			 * say again, so the file itself is all a second import has to go on:
			 * the same name holding the same number of bytes is taken to be this
			 * attachment again, and any other file of that name belongs to
			 * something else and is passed over. Airtable's do the same.
			 */
			placeAttachment: async (fileName, notePath, size): Promise<PlacedAttachment> => {
				const { path, reuse } = await this.placeAttachment(fileName, notePath,
					existing => existing.stat.size === size ? 'same' : 'another');

				return { path, write: reuse === null };
			},

			/**
			 * The link Obsidian would write itself, in whatever form the user
			 * has set. Writing the whole path instead would resolve, but the
			 * standardizing pass carries a wikilink's text over as its display
			 * text - so the note would end up reading "embedded.png|Attachments/
			 * embedded.png". The file is written by the time this is asked.
			 */
			linkTo: (path, fromNote) => {
				const file = vault.getAbstractFileByPath(path);

				return file instanceof TFile
					? this.app.metadataCache.fileToLinktext(file, fromNote)
					: path;
			},

			writeAttachment: async (path, data, times) => {
				await this.createFolders(parentOf(path));
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
			markdownOutput: markdownOutputFor(this.app.vault),
		}, this.outputInto(ctx), ctx);
	}
}

function parentOf(path: string): string {
	return path.slice(0, path.lastIndexOf('/')) || '/';
}
