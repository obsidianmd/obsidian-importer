/**
 * .enex to Markdown.
 *
 * This began as Yarle by Akos Balasko (https://github.com/akosbalasko/yarle,
 * MIT) and has been adapted since: it reads node through src/filesystem, writes
 * through this project's Markdown formatting, and reports to an ImportContext.
 * It is no longer tracking upstream, which is why it is named for what it does
 * rather than for where it came from.
 *
 * Unlike every other conversion here it writes files itself rather than handing
 * markdown back, because a note's attachments and the links to them are settled
 * across the whole export rather than one note at a time.
 */
import { EvernoteNote, EvernoteNoteAttributes, EvernoteResourceAttributes } from './models/EvernoteNote';
import { fs, NodePickedFile, PickedFile } from '../../filesystem';
import { ImportContext } from '../../import-context';
import { mapEvernoteTask } from './models/EvernoteTask';
import { formatMarkdown } from '../../markdown-output';
import { getMarkdownOutput, EvernoteOptions } from './options';
import { processNode } from './process-node';
import { rewriteFile } from './utils/file-utils';
import { convertTasktoMd } from './process-tasks';
import { RuntimePropertiesSingleton } from './runtime-properties';

import * as utils from './utils';
import { applyLinks } from './utils/apply-links';
import { isWebClip } from './utils/note-utils';
import {
	hasAnyTagsInTemplate,
	hasCreationTimeInTemplate,
	hasLocationInTemplate,
	hasNotebookInTemplate,
	hasSourceURLInTemplate,
	hasUpdateTimeInTemplate,
} from './utils/templates/checker-functions';
import { defaultTemplate } from './utils/templates/default-template';

let flow: typeof import('xml-flow') | undefined;

export const defaultEvernoteOptions: EvernoteOptions = {
	enexSources: [],
	currentTemplate: '',
	outputDir: './mdNotes',
	isMetadataNeeded: false,
	isNotebookNameNeeded: false,
	isZettelkastenNeeded: false,
	useZettelIdAsFilename: false,
	plainTextNotesOnly: false,
	skipWebClips: false,
	useHashTags: true,
	nestedTags: {
		separatorInEN: '_',
		replaceSeparatorWith: '/',
		replaceSpaceWith: '-',
	},
	obsidianTaskTag: '',
	urlEncodeFileNamesAndLinks: false,
	sanitizeResourceNameSpaces: false,
	replacementChar: '_',
	pathSeparator: '/',
	resourcesDir: '_resources',
	turndownOptions: {
		headingStyle: 'atx',
	},
};

const NOTEBOOKSTACK_SEPARATOR = '@@@';

export let evernoteOptions: EvernoteOptions = { ...defaultEvernoteOptions };

function deepCopy(obj: any) {
	if (obj === undefined || obj === null) return obj;
	return JSON.parse(JSON.stringify(obj));
}

function merge(original: any, ...objects: any[]) {
	for (let object of objects) {
		for (let key of Object.keys(object)) {
			let value = object[key];
			let originalValue = original[key];

			if (!Array.isArray(value) && typeof value === 'object' &&
				!Array.isArray(originalValue) && typeof originalValue === 'object') {
				original[key] = merge({}, originalValue, value);
			}
			else {
				original[key] = deepCopy(value);
			}
		}
	}

	return original;
}

const setOptions = (options: EvernoteOptions): void => {
	evernoteOptions = merge({}, defaultEvernoteOptions, options);

	let template = (evernoteOptions.templateFile) ? fs.readFileSync(evernoteOptions.templateFile, 'utf-8') : defaultTemplate;
	template = evernoteOptions.currentTemplate ? evernoteOptions.currentTemplate : template;

	/*if (evernoteOptions.templateFile) {*/
	// todo: handle file not exists error
	evernoteOptions.skipCreationTime = !hasCreationTimeInTemplate(template);
	evernoteOptions.skipLocation = !hasLocationInTemplate(template);
	evernoteOptions.skipSourceUrl = !hasSourceURLInTemplate(template);
	evernoteOptions.skipTags = !hasAnyTagsInTemplate(template);
	evernoteOptions.skipUpdateTime = !hasUpdateTimeInTemplate(template);
	evernoteOptions.isNotebookNameNeeded = hasNotebookInTemplate(template);

	evernoteOptions.currentTemplate = template;

	/*}*/
};

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

export const parseStream = async (options: EvernoteOptions, enexSource: PickedFile, ctx: ImportContext): Promise<void> => {
	if (!(enexSource instanceof NodePickedFile)) throw new Error('Evernote import currently only works on desktop');
	const runtimeProps = RuntimePropertiesSingleton.getInstance();

	// Load this optional native module only on the desktop import path.
	const parseXml = flow ??= (await import('xml-flow')).default;

	ctx.status('Processing ' + enexSource.name);
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

			if (options.skipWebClips && isWebClip(note)) {
				ctx.reportSkipped(note.title ?? enexSource.name);
			}
			else {
				ctx.status('Importing note ' + note.title);
				if (noteAttributes) {
					// make sure single attributes are not collapsed
					note['note-attributes'] = noteAttributes;
				}
				restoreResourceAttributes(note, resourceAttributes);

				try {
					const reported = notebookName + '/' + note.title;
					wrote = processNode(note, notebookName);
					if (wrote) ctx.reportNoteSuccess(reported);
					else ctx.reportSkipped(reported, 'it is already in the vault');
				}
				catch (e) {
					ctx.reportFailed(note.title || enexSource.name, e);
					return resolve();
				}
			}
			noteAttributes = null;
			resourceAttributes = [];

			// Only the note this pass just wrote. Without the check a note left
			// alone would be reopened here under the previous note's path.
			const currentNotePath = wrote ? runtimeProps.getCurrentNotePath() : '';
			if (currentNotePath) {
				for (const task of Object.keys(tasks)) {

					const taskPlaceholder = `<ENEX-EN-V10-TASK>${task}</ENEX-EN-V10-TASK>`;
					const fileContent = fs.readFileSync(currentNotePath, 'utf8');
					const sortedTasks = new Map([...tasks[task]].sort());

					let updatedContent = fileContent.replace(taskPlaceholder, [...sortedTasks.values()].join('\n'));

					rewriteFile(currentNotePath, formatMarkdown(updatedContent, getMarkdownOutput()));
				}
			}
		});

		xml.on('tag:task', (pureTask: any) => {
			const task = mapEvernoteTask(pureTask);
			if (!tasks[task.taskgroupnotelevelid]) {
				tasks[task.taskgroupnotelevelid] = new Map();
			}

			tasks[task.taskgroupnotelevelid].set(task.sortweight, convertTasktoMd(task, notebookName));

		});

		xml.on('end', resolve);
		xml.on('error', logAndReject);
		stream.on('error', logAndReject);
	});
};

export async function convertEnexFiles(options: EvernoteOptions, ctx: ImportContext): Promise<void> {
	setOptions(options);
	const outputNotebookFolders = [];
	const orginalOutputDir = options.outputDir;
	for (const enex of options.enexSources) {
		if (await ctx.shouldStop()) return;

		
		let notebookStackProperties;
		const runtimeProps = RuntimePropertiesSingleton.getInstance();

		if (enex.basename.includes(NOTEBOOKSTACK_SEPARATOR)) {
			options.outputDir = utils.getNotebookStackOutputDir(enex, options);
			notebookStackProperties = utils.getNotebookStackedProps(enex);

			utils.setNotebookStackPaths(notebookStackProperties, options);
			runtimeProps.setCurrentNotebookName(notebookStackProperties.basename);
			runtimeProps.setCurrentNotebookFullpath(notebookStackProperties.fullpath);
		}	
		else {
			utils.setSingleNotebookPaths(enex, options);
			runtimeProps.setCurrentNotebookName(enex.basename);
			runtimeProps.setCurrentNotebookFullpath(enex.fullpath);
		}

		
		await parseStream(options, enex, ctx);
		outputNotebookFolders.push(utils.getNotesPath());
		options.outputDir = orginalOutputDir;
	}

	if (await ctx.shouldStop()) return;
	applyLinks(options, outputNotebookFolders);
}
