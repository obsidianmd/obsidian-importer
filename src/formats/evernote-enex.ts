import { normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { DuplicateHandling, FormatImporter, leavesTheNoteAlone, NoteDisposition, NoteTemplateSample, PlannedNote, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { defaultEvernoteOptions } from './evernote/options';
import { convertEnexFiles } from './evernote/convert';
import { parseFilePath } from '../filesystem';
import { availableFileName } from '../util';
import { EvernoteOutput, PlacedAttachment } from './evernote/output';
import { parseEnex } from './evernote/parse-enex';
import { EvernoteNote, joinNoteContent } from './evernote/models/EvernoteNote';
import { EvernoteRun } from './evernote/run';
import { convertHtml2Md } from './evernote/convert-html-to-md';
import { noteTimes } from './evernote/utils/note-times';


interface EnexPlan {
	planned: PlannedNote;
	reportAs: string;
	disposition: NoteDisposition;
}

export class EvernoteEnexImporter extends FormatImporter {
	static extensions = ['enex'];

	interruption = 'pause' as const;

	init() {
		this.addInstructions(this.addExportSetting(i18n.importer.evernote.descExport()));

		this.addFileChooserSetting(i18n.importer.evernote.fileType(), EvernoteEnexImporter.extensions, true);
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

			planNote: async (folder, title, reportAs) => {
				const planned = await this.planTemplatedNote(folder, title);
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

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		const output: EvernoteOutput = {
			planFolder: (parent, name) => normalizePath(`${parent}/${name}`),
			planNote: async (folder, title) => normalizePath(`${folder}/${title}.md`),
			willImport: () => true,
			writeNote: async () => {},
			placeAttachment: async fileName => ({ path: fileName, write: false }),
			linkTo: path => path,
			writeAttachment: async () => {},
		};
		const run = new EvernoteRun(defaultEvernoteOptions, output);

		for (const file of this.files) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			await parseEnex(file, {
				wanted: new Set(['note']),
				isCancelled: () => samples.length >= TEMPLATE_PREVIEW_LIMIT || ctx.isCancelled(),
				checkpoint: async () => samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop(),
				onElement: (name, element) => {
					if (name !== 'note' || typeof element === 'string' || samples.length >= TEMPLATE_PREVIEW_LIMIT) return;
					try {
						const note = element as EvernoteNote;
						const title = note.title?.trim() || 'Untitled';
						// Resources need decoding and placement. Leave an explicit marker
						// while still converting the rest of the selected note.
						const htmlContent = joinNoteContent(note.content)
							.replace(/<en-media\b[^>]*\/?\s*>/gi, '<p>(attachment)</p>');
						const content = convertHtml2Md(run, { title, content: htmlContent, htmlContent }).content;
						samples.push({
							title,
							path: normalizePath(`${this.outputLocation}/${file.basename}/${title}.md`),
							content,
							times: noteTimes(note),
						});
					}
					catch (error) {
						console.warn(`Could not preview Evernote note from ${file.fullpath}`, error);
					}
				},
			});
		}

		return samples;
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
