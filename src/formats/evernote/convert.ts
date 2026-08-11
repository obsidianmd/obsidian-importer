/** Evernote converter adapted from Yarle (MIT): https://github.com/akosbalasko/yarle */
import { EvernoteNote, EvernoteNoteAttributes, EvernoteResourceAttributes } from './models/EvernoteNote';
import { fs, NodePickedFile, PickedFile } from '../../filesystem';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import { mapEvernoteTask } from './models/EvernoteTask';
import { formatMarkdown } from '../../markdown-output';
import { EvernoteOptions } from './options';
import { EvernoteRun } from './run';
import { processNode } from './process-node';
import { rewriteFile } from './utils/file-utils';
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

	return new Promise((resolve, reject) => {
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

			const currentNotePath = wrote ? runtimeProps.getCurrentNotePath() : '';
			if (currentNotePath) {
				for (const task of Object.keys(tasks)) {

					const taskPlaceholder = `<ENEX-EN-V10-TASK>${task}</ENEX-EN-V10-TASK>`;
					const fileContent = fs.readFileSync(currentNotePath, 'utf8');
					const sortedTasks = new Map([...tasks[task]].sort());

					let updatedContent = fileContent.replace(taskPlaceholder, [...sortedTasks.values()].join('\n'));

					rewriteFile(run, currentNotePath, formatMarkdown(updatedContent, run.markdownOutput));
				}
			}
		});

		xml.on('tag:task', (pureTask: any) => {
			const task = mapEvernoteTask(pureTask);
			if (!tasks[task.taskgroupnotelevelid]) {
				tasks[task.taskgroupnotelevelid] = new Map();
			}

			tasks[task.taskgroupnotelevelid].set(task.sortweight, convertTasktoMd(run, task));

		});

		xml.on('end', resolve);
		xml.on('error', logAndReject);
		stream.on('error', logAndReject);
	});
};

export async function convertEnexFiles(options: EvernoteOptions, ctx: ImportContext): Promise<void> {
	const run = new EvernoteRun(options);
	const outputNotebookFolders = [];

	for (const enex of run.options.enexSources) {
		if (await ctx.shouldStop()) return;

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
		outputNotebookFolders.push(run.paths.mdPath);
	}

	if (await ctx.shouldStop()) return;
	applyLinks(run, outputNotebookFolders);
}
