import { EvernoteNote, EvernoteNoteAttributes, EvernoteResourceAttributes } from './models/EvernoteNote';
import { fs, NodePickedFile, PickedFile } from '../../filesystem';
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

/**
 * xml-flow, loaded only when an .enex is actually parsed.
 *
 * Its top level calls require('events'). Node builtins are external in this
 * bundle, so evaluating it on mobile throws - a static import would do that at
 * plugin load. import() keeps esbuild's lazy wrapper, so the module is only
 * evaluated on the desktop-only path in parseStream.
 */
let flow: typeof import('xml-flow') | undefined;

export const defaultYarleOptions: YarleOptions = {
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

export let yarleOptions: YarleOptions = { ...defaultYarleOptions };

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

const setOptions = (options: YarleOptions): void => {
	yarleOptions = merge({}, defaultYarleOptions, options);

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

	/*}*/
};

interface TaskGroups {
	[key: string]: Map<string, string>;
}

/**
 * Put each resource's attributes back as an object.
 *
 * The collected events are in document order, but only resources that carried
 * a resource-attributes element produced one, so the queue is consumed in step
 * with those rather than by position - otherwise a note whose first attachment
 * has no attributes would hand them to the wrong resource.
 */
function restoreResourceAttributes(note: EvernoteNote, collected: EvernoteResourceAttributes[]): void {
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

export const parseStream = async (options: YarleOptions, enexSource: PickedFile, ctx: ImportContext): Promise<void> => {
	if (!(enexSource instanceof NodePickedFile)) throw new Error('Evernote import currently only works on desktop');
	const runtimeProps = RuntimePropertiesSingleton.getInstance();

	// Captured locally: TypeScript cannot narrow the module-level binding
	// inside the Promise executor below.
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

		// Resources have the same problem as note-attributes: when
		// resource-attributes holds a single child, xml-flow hands back that
		// child's value instead of an object, so the field name is lost and an
		// attachment whose only attribute is its file-name imports as
		// "unknown_filename". The tag event still carries the object, so they
		// are collected in document order and put back on the note below.
		let resourceAttributes: EvernoteResourceAttributes[] = [];
		xml.on('tag:resource-attributes', (ra: EvernoteResourceAttributes) => {
			resourceAttributes.push(ra);
		});

		xml.on('tag:note', (note: EvernoteNote) => {
			if (ctx.isCancelled()) {
				stream.close();
				return;
			}

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
					processNode(note, notebookName);
					ctx.reportNoteSuccess(notebookName + '/' + note.title);
				}
				catch (e) {
					ctx.reportFailed(note.title || enexSource.name, e);
					return resolve();
				}
			}
			noteAttributes = null;
			// Cleared per note, including a skipped one, so the next note's
			// resources do not pick up attributes belonging to this one.
			resourceAttributes = [];

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
	applyLinks(options, outputNotebookFolders);
}
