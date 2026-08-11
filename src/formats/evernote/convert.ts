/** Evernote converter adapted from Yarle (MIT): https://github.com/akosbalasko/yarle */
import { EvernoteNote, EvernoteNoteAttributes, EvernoteResourceAttributes } from './models/EvernoteNote';
import { NodePickedFile, PickedFile } from '../../filesystem';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import { mapEvernoteTask } from './models/EvernoteTask';
import { EvernoteOptions } from './options';
import { EvernoteOutput } from './output';
import { EvernoteRun } from './run';
import { processNode } from './process-node';
import { commit } from './utils/commit';
import { convertTasktoMd } from './process-tasks';

import * as utils from './utils';
import { applyLinks } from './utils/apply-links';
import { isWebClip } from './utils/note-utils';

let flow: typeof import('xml-flow') | undefined;

const NOTEBOOKSTACK_SEPARATOR = '@@@';

interface TaskGroups {
	[key: string]: Map<string, string>;
}

function restoreResourceAttributes(note: EvernoteNote, collected: EvernoteResourceAttributes[]): void {
	// xml-flow collapses a single resource-attributes object into its child value.
	if (collected.length === 0) return;

	const resources = Array.isArray(note.resource) ? note.resource
		: note.resource ? [note.resource]
			: [];

	let next = 0;
	for (const resource of resources) {
		if (resource['resource-attributes'] === undefined) continue;
		const attributes = collected[next++];
		if (attributes) resource['resource-attributes'] = attributes;
	}
}

export const parseStream = async (run: EvernoteRun, enexSource: PickedFile, ctx: ImportContext): Promise<void> => {
	if (!(enexSource instanceof NodePickedFile)) throw new Error('Evernote import currently only works on desktop');
	const runtimeProps = run.properties;

	// Load this optional native module only on the desktop import path.
	const parseXml = flow ??= (await import('xml-flow')).default;

	ctx.status(i18n.common.statusProcessing({ name: enexSource.name }));
	const stream = enexSource.createReadStream();
	const tasks: TaskGroups = {}; // key: taskId value: generated md text
	const notebookName = runtimeProps.getCurrentNotebookName();
	const firstDraft = run.drafts.length;

	/** The task groups a note carries are only known once its enex has been read. */
	const spliceTasks = () => {
		for (const draft of run.drafts.slice(firstDraft)) {
			for (const task of Object.keys(tasks)) {
				const taskPlaceholder = `<ENEX-EN-V10-TASK>${task}</ENEX-EN-V10-TASK>`;
				const sortedTasks = new Map([...tasks[task]].sort());

				draft.markdown = draft.markdown.replace(taskPlaceholder, [...sortedTasks.values()].join('\n'));
			}
		}
	};

	return new Promise((resolve, reject) => {
		// A cancelled read closes the stream, which ends it without ever ending
		// the parser - so 'end' does not arrive and this would wait forever.
		// 'close' follows 'end' on a stream that was read to the finish, so the
		// notes are spliced either way and only once.
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			spliceTasks();
			resolve();
		};

		const logAndReject = (e: Error) => {
			ctx.reportFailed(runtimeProps.getCurrentNotebookFullpath(), e);
			return reject(e);
		};

		const xml = parseXml(stream);

		let noteAttributes: EvernoteNoteAttributes | null = null;
		xml.on('tag:note-attributes', (na: EvernoteNoteAttributes) => {
			noteAttributes = na;
		});

		let resourceAttributes: EvernoteResourceAttributes[] = [];
		xml.on('tag:resource-attributes', (ra: EvernoteResourceAttributes) => {
			resourceAttributes.push(ra);
		});

		xml.on('tag:note', (note: EvernoteNote) => {
			if (ctx.isCancelled()) {
				stream.close();
				return;
			}

			let wrote = false;

			if (run.options.skipWebClips && isWebClip(note)) {
				ctx.reportSkipped(note.title ?? enexSource.name);
			}
			else {
				// String(), because concatenation was what showed a missing title before.
				ctx.status(i18n.common.statusImportingNote({ name: String(note.title) }));
				if (noteAttributes) {
					// make sure single attributes are not collapsed
					note['note-attributes'] = noteAttributes;
				}
				restoreResourceAttributes(note, resourceAttributes);

				try {
					const reported = notebookName + '/' + note.title;
					wrote = processNode(run, note);
					if (wrote) ctx.reportNoteSuccess(reported);
					else ctx.reportSkipped(reported, i18n.reason.alreadyInVault());
				}
				catch (e) {
					ctx.reportFailed(note.title || enexSource.name, e);
					return resolve();
				}
			}
			noteAttributes = null;
			resourceAttributes = [];
		});

		xml.on('tag:task', (pureTask: any) => {
			const task = mapEvernoteTask(pureTask);
			if (!tasks[task.taskgroupnotelevelid]) {
				tasks[task.taskgroupnotelevelid] = new Map();
			}

			tasks[task.taskgroupnotelevelid].set(task.sortweight, convertTasktoMd(run, task));

		});

		xml.on('end', finish);
		stream.on('close', finish);
		xml.on('error', logAndReject);
		stream.on('error', logAndReject);
	});
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
