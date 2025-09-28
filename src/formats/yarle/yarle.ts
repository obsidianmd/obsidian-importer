import { Platform } from 'obsidian';
import { fs, NodePickedFile, path, PickedFile } from '../../filesystem';
import { ImportContext } from '../../main';
import { mapEvernoteTask } from './models/EvernoteTask';
import { YarleOptions } from './options';
import { processNode } from './process-node';
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
import { Note, NoteAttributes, NoteAttributesSchema, NoteSchema } from './schemas/note';
import { TaskSchema } from './schemas/task';
import { BaseIssue, BaseSchema, safeParse, summarize as summarizeIssues } from 'valibot';
import { Resource, ResourceAttributes, ResourceAttributesSchema, ResourceSchema } from './schemas/resource';

const flow: typeof import('xml-flow') = Platform.isDesktopApp ? require('xml-flow') : null;

export const defaultYarleOptions = {
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
} satisfies YarleOptions;

const NOTEBOOKSTACK_SEPARATOR = '@@@';

export let yarleOptions: YarleOptions = { ...defaultYarleOptions };

const setOptions = (options: YarleOptions): void => {
	yarleOptions = {
		...defaultYarleOptions,
		...options,
		nestedTags: { ...defaultYarleOptions.nestedTags, ...options.nestedTags },
		turndownOptions: { ...defaultYarleOptions.turndownOptions, ...options.turndownOptions },
	};

	let template = (yarleOptions.templateFile) ? fs.readFileSync(yarleOptions.templateFile, 'utf-8') : defaultTemplate;
	template = yarleOptions.currentTemplate ? yarleOptions.currentTemplate : template;

	/*if (yarleOptions.templateFile) {*/
	// todo: handle file not exists error
	yarleOptions.skipCreationTime = !hasCreationTimeInTemplate(template);
	yarleOptions.skipLocation = !hasLocationInTemplate(template);
	yarleOptions.skipSourceUrl = !hasSourceURLInTemplate(template);
	yarleOptions.skipTags = !hasAnyTagsInTemplate(template);
	yarleOptions.skipUpdateTime = !hasUpdateTimeInTemplate(template);
	yarleOptions.isNotebookNameNeeded = hasNotebookInTemplate(template);

	yarleOptions.currentTemplate = template;

	console.log(`Current config is: ${JSON.stringify(yarleOptions, null, 4)}`);
	console.log(`Path separator:${path.sep}`);
	/*}*/
};

interface TaskGroups {
	[key: string]: Map<string, string>;
}

export const parseStream = async (options: YarleOptions, enexSource: PickedFile, ctx: ImportContext): Promise<void> => {
	if (!(enexSource instanceof NodePickedFile)) throw new Error('Evernote import currently only works on desktop');
	const runtimeProps = RuntimePropertiesSingleton.getInstance();

	ctx.status('Processing ' + enexSource.name);
	console.log(`Getting stream from ${enexSource}`);
	const stream = enexSource.createReadStream();
	const tasks: TaskGroups = {}; // key: taskId value: generated md text
	const notebookName = runtimeProps.getCurrentNotebookName();

	return new Promise((resolve, reject) => {
		const logAndReject = (e: Error) => {
			ctx.reportFailed(runtimeProps.getCurrentNotebookFullpath(), e);
			return reject(e);
		};
		const tryParse = <T>(schema: BaseSchema<T, T, BaseIssue<unknown>>, data: Record<string, unknown>, failMessage: string): T | null => {
			const result = safeParse(schema, data);
			if (!result.success) {
				console.error(`${failMessage}: ${summarizeIssues(result.issues)}`, data);
				return null;
			}
			return result.output;
		};

		const xml = flow(stream);

		let noteAttributes: NoteAttributes | null = null;
		xml.on('tag:note-attributes', (na: Record<string, unknown>) => {
			noteAttributes = tryParse(NoteAttributesSchema, na, 'Failed to parse note-attributes');
		});

		let resourceAttributes: ResourceAttributes | null = null;
		xml.on('tag:resource-attributes', (ra: Record<string, unknown>) => {
			resourceAttributes = tryParse(ResourceAttributesSchema, ra, 'Failed to parse resource-attributes');
		});

		let resources: Resource[] = [];
		xml.on('tag:resource', (pureResource: Record<string, unknown>) => {
			if (resourceAttributes) {
				pureResource['resource-attributes'] = resourceAttributes;
			}
			resourceAttributes = null;

			const resource = tryParse(ResourceSchema, pureResource, 'Failed to parse resource');
			if (resource !== null) {
				resources.push(resource);
			}
		});

		xml.on('tag:note', (pureNote: Record<string, unknown>) => {
			if (ctx.isCancelled()) {
				stream.close();
				return;
			}

			if (noteAttributes) {
				// make sure single attributes are not collapsed
				pureNote['note-attributes'] = noteAttributes;
			}
			noteAttributes = null;
			pureNote['resource'] = resources;
			resources = [];
			const note: Note | null = tryParse(NoteSchema, pureNote, 'Failed to parse note');
			if (note === null) {
				return;
			}
			if (options.skipWebClips && isWebClip(note)) {
				ctx.reportSkipped(note.title);
			}
			else {
				ctx.status('Importing note ' + note.title);

				try {
					processNode(note, notebookName);
					ctx.reportNoteSuccess(notebookName + '/' + note.title);
				}
				catch (e) {
					ctx.reportFailed(note.title || enexSource.fullpath, e);
					return resolve();
				}
			}

			const currentNotePath = runtimeProps.getCurrentNotePath();
			if (currentNotePath) {
				for (const task of Object.keys(tasks)) {

					const taskPlaceholder = `<YARLE-EN-V10-TASK>${task}</YARLE-EN-V10-TASK>`;
					const fileContent = fs.readFileSync(currentNotePath, 'utf8');
					const sortedTasks = new Map([...tasks[task]].sort());

					let updatedContent = fileContent.replace(taskPlaceholder, [...sortedTasks.values()].join('\n'));

					fs.writeFileSync(currentNotePath, updatedContent);
				}
			}
		});

		xml.on('tag:task', (pureTask: Record<string, unknown>) => {
			const task = tryParse(TaskSchema, pureTask, 'Failed to parse task');
			if (task === null) {
				return;
			}
			const evernoteTask = mapEvernoteTask(task);
			if (!tasks[evernoteTask.taskgroupnotelevelid]) {
				tasks[evernoteTask.taskgroupnotelevelid] = new Map();
			}

			tasks[evernoteTask.taskgroupnotelevelid].set(evernoteTask.sortweight, convertTasktoMd(evernoteTask, notebookName));

		});

		xml.on('end', resolve);
		xml.on('error', logAndReject);
		stream.on('error', logAndReject);
	});
};

export async function dropTheRope(options: YarleOptions, ctx: ImportContext): Promise<void> {
	setOptions(options);
	const outputNotebookFolders = [];
	const orginalOutputDir = options.outputDir;
	for (const enex of options.enexSources) {
		if (ctx.isCancelled()) return;

		
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

	if (ctx.isCancelled()) return;
	await applyLinks(options, outputNotebookFolders);
}
