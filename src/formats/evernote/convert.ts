/** Evernote converter adapted from Yarle (MIT): https://github.com/akosbalasko/yarle */
import { EvernoteNote } from './models/EvernoteNote';
import { PickedFile } from '../../filesystem';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import { mapEvernoteTask } from './models/EvernoteTask';
import { EvernoteOptions } from './options';
import { EvernoteOutput } from './output';
import { EvernoteRun } from './run';
import { processNode } from './process-node';
import { commitNotes, commitResources } from './utils/commit';
import { convertTasktoMd } from './process-tasks';

import { parseEnex } from './parse-enex';
import * as utils from './utils';
import { applyLinks } from './utils/apply-links';
import { isWebClip } from './utils/note-utils';

/** The elements a conversion is called back about, and nothing else. */
const WANTED = new Set(['note', 'task']);

/** What div-rule leaves where a note's task group belongs. */
const TASK_PLACEHOLDER = '<ENEX-EN-V10-TASK>';

interface TaskGroups {
	[key: string]: Map<string, string>;
}

export const parseStream = async (run: EvernoteRun, enexSource: PickedFile, ctx: ImportContext): Promise<void> => {
	const runtimeProps = run.properties;

	ctx.status(i18n.common.statusProcessing({ name: enexSource.name }));
	const tasks: TaskGroups = {}; // key: taskId value: generated md text
	const notebookName = runtimeProps.getCurrentNotebookName();
	const firstDraft = run.drafts.length;

	const importNote = (note: EvernoteNote) => {
		if (run.options.skipWebClips && isWebClip(note)) {
			ctx.reportSkipped(note.title ?? enexSource.name);
			return;
		}

		// String(), because concatenation was what showed a missing title before.
		ctx.status(i18n.common.statusImportingNote({ name: String(note.title) }));

		try {
			// Neither outcome is reported here. A note left alone is reported by
			// the preflight, and one being written is reported by the write - a
			// note whose export carries no <updated> is not settled until its
			// markdown can be compared with what is already in the vault, which
			// is at the commit. Reporting a success here counted that note twice.
			processNode(run, note, notebookName + '/' + note.title);
		}
		catch (e) {
			ctx.reportFailed(note.title || enexSource.name, e);
		}
	};

	try {
		await parseEnex(enexSource, {
			wanted: WANTED,
			isCancelled: () => ctx.isCancelled(),
			// A checkpoint between pieces of the file, so an import can be
			// paused part-way through a notebook rather than only between them.
			checkpoint: () => ctx.shouldStop(),
			onElement: (name, element) => {
				if (typeof element === 'string') return;

				if (name === 'note') {
					importNote(element as EvernoteNote);
					return;
				}

				const task = mapEvernoteTask(element);
				tasks[task.taskgroupnotelevelid] ??= new Map();
				tasks[task.taskgroupnotelevelid].set(task.sortweight, convertTasktoMd(run, task));
			},
		});
	}
	catch (e) {
		ctx.reportFailed(runtimeProps.getCurrentNotebookFullpath(), e);
		throw e;
	}

	// The task groups a note carries are only known once its enex has been read.
	// Each group is sorted once here rather than once per note: the group is
	// what its order depends on, and the note it lands in is not part of that.
	const groups = Object.entries(tasks).map(([id, group]) => ({
		placeholder: `<ENEX-EN-V10-TASK>${id}</ENEX-EN-V10-TASK>`,
		text: [...new Map([...group].sort()).values()].join('\n'),
	}));

	for (const draft of run.drafts.slice(firstDraft)) {
		// A note with no task carries no placeholder for any of them.
		if (!draft.markdown.includes(TASK_PLACEHOLDER)) continue;

		for (const { placeholder, text } of groups) {
			draft.markdown = draft.markdown.replace(placeholder, text);
		}
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

		// A notebook stack is written into the file name as "Stack@@@Notebook",
		// and a name with no separator in it is a stack of one - which is why
		// there is no second case here.
		const notebook = utils.getNotebookStackedProps(enex);

		utils.setPaths(run, notebook.basename, utils.getNotebookStackOutputDir(enex, run.options.outputDir));
		run.properties.setCurrentNotebookName(notebook.basename);
		run.properties.setCurrentNotebookFullpath(notebook.fullpath);

		const firstDraft = run.drafts.length;
		await parseStream(run, enex, ctx);
		await commitResources(run, firstDraft);
	}

	// A link can point into a notebook read later, so this waits for all of them.
	if (!stopped && !(await ctx.shouldStop())) applyLinks(run);

	// What has been converted is written whether or not the rest of it was: an
	// import the user stopped still leaves the notes it had already read.
	await commitNotes(run);
}
