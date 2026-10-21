/** Evernote converter adapted from Yarle (MIT): https://github.com/akosbalasko/yarle */
import { EvernoteNote } from './models/EvernoteNote';
import { PickedFile } from '../../filesystem';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import { EvernoteTask, mapEvernoteTask } from './models/EvernoteTask';
import { EvernoteOptions } from './options';
import { EvernoteOutput } from './output';
import { EvernoteRun } from './run';
import { processNode } from './process-node';
import { commitNotes, commitResources } from './utils/commit';

import { parseEnex } from './parse-enex';
import * as utils from './utils';
import { applyLinks } from './utils/apply-links';
import { isWebClip } from './utils/note-utils';

const WANTED = new Set(['note', 'task']);

export const parseStream = async (run: EvernoteRun, enexSource: PickedFile, ctx: ImportContext): Promise<void> => {
	const runtimeProps = run.properties;

	ctx.status(i18n.common.statusProcessing({ name: enexSource.name }));
	const notebookName = runtimeProps.getCurrentNotebookName();
	// A note's tasks close before the note does.
	let tasks: EvernoteTask[] = [];

	const importNote = async (note: EvernoteNote, noteTasks: EvernoteTask[]): Promise<void> => {
		if (run.options.skipWebClips && isWebClip(note)) {
			ctx.reportSkipped(note.title ?? enexSource.name);
			return;
		}

		ctx.status(i18n.common.statusImportingNote({ name: String(note.title) }));

		try {
			await processNode(run, note, noteTasks, notebookName + '/' + note.title);
		}
		catch (e) {
			ctx.reportFailed(note.title || enexSource.name, e);
		}
	};

	try {
		await parseEnex(enexSource, {
			wanted: WANTED,
			isCancelled: () => ctx.isCancelled(),
			checkpoint: () => ctx.shouldStop(),
			onElement: async (name, element) => {
				if (name === 'task') {
					if (typeof element !== 'string') tasks.push(mapEvernoteTask(element));
					return;
				}

				const noteTasks = tasks;
				tasks = [];
				if (typeof element !== 'string') await importNote(element, noteTasks);
			},
		});
	}
	catch (e) {
		ctx.reportFailed(runtimeProps.getCurrentNotebookFullpath(), e);
		throw e;
	}
};

export async function convertEnexFiles(options: EvernoteOptions, output: EvernoteOutput, ctx: ImportContext): Promise<void> {
	const run = new EvernoteRun(options, output);
	let stopped = false;

	for (const enex of run.options.enexSources) {
		if (await ctx.shouldStop()) {
			stopped = true;
			break;
		}

		const notebook = utils.getNotebookStackedProps(enex);

		utils.setPaths(run, notebook.basename, utils.getNotebookStackOutputDir(enex, run.options.outputDir));
		run.properties.setCurrentNotebookName(notebook.basename);
		run.properties.setCurrentNotebookFullpath(notebook.fullpath);

		const firstDraft = run.drafts.length;
		await parseStream(run, enex, ctx);
		await commitResources(run, firstDraft, ctx);
	}

	// Resolve links after every notebook has been planned.
	if (!stopped && !(await ctx.shouldStop())) {
		const unresolved = applyLinks(run);
		if (unresolved > 0) ctx.reportMessage(i18n.importer.evernote.msgUnresolvedLinks({ count: unresolved }));
	}

	// Keep notes converted before cancellation.
	await commitNotes(run, ctx);
}
