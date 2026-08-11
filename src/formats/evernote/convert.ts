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
import { commit } from './utils/commit';
import { convertTasktoMd } from './process-tasks';

import { parseEnex } from './parse-enex';
import * as utils from './utils';
import { applyLinks } from './utils/apply-links';
import { isWebClip } from './utils/note-utils';

const NOTEBOOKSTACK_SEPARATOR = '@@@';

/** The elements a conversion is called back about, and nothing else. */
const WANTED = new Set(['note', 'task']);

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
			// A note left alone is reported by the preflight, which is what knows
			// whether it was skipped, unchanged or preserved.
			const reported = notebookName + '/' + note.title;
			if (processNode(run, note, reported)) ctx.reportNoteSuccess(reported);
		}
		catch (e) {
			ctx.reportFailed(note.title || enexSource.name, e);
		}
	};

	try {
		await parseEnex(enexSource, {
			wanted: WANTED,
			isCancelled: () => ctx.isCancelled(),
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
	for (const draft of run.drafts.slice(firstDraft)) {
		for (const task of Object.keys(tasks)) {
			const taskPlaceholder = `<ENEX-EN-V10-TASK>${task}</ENEX-EN-V10-TASK>`;
			const sortedTasks = new Map([...tasks[task]].sort());

			draft.markdown = draft.markdown.replace(taskPlaceholder, [...sortedTasks.values()].join('\n'));
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

		if (enex.basename.includes(NOTEBOOKSTACK_SEPARATOR)) {
			const notebookStackProperties = utils.getNotebookStackedProps(enex);

			utils.setPaths(run, notebookStackProperties.basename, utils.getNotebookStackOutputDir(enex, run.options.outputDir));
			run.properties.setCurrentNotebookName(notebookStackProperties.basename);
			run.properties.setCurrentNotebookFullpath(notebookStackProperties.fullpath);
		}
		else {
			utils.setPaths(run, enex.basename, run.options.outputDir);
			run.properties.setCurrentNotebookName(enex.basename);
			run.properties.setCurrentNotebookFullpath(enex.fullpath);
		}

		await parseStream(run, enex, ctx);
	}

	// A link can point into a notebook read later, so this waits for all of them.
	if (!stopped && !(await ctx.shouldStop())) applyLinks(run);

	// What has been converted is written whether or not the rest of it was: an
	// import the user stopped still leaves the notes it had already read.
	await commit(run);
}
