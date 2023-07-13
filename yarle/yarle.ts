import fs from 'fs';
import * as path from 'path';
import flow from 'xml-flow';
import { mapEvernoteTask } from './models/EvernoteTask';
import { processNode } from './process-node';
import { convertTasktoMd } from './process-tasks';
import { RuntimePropertiesSingleton } from './runtime-properties';

import * as utils from './utils';
import { applyLinks } from './utils/apply-links';
import { isWebClip } from './utils/note-utils';
import { hasAnyTagsInTemplate, hasCreationTimeInTemplate, hasLocationInTemplate, hasNotebookInTemplate, hasSourceURLInTemplate, hasUpdateTimeInTemplate } from './utils/templates/checker-functions';
import { defaultTemplate } from './utils/templates/default-template';
import { YarleOptions } from './YarleOptions';

export const defaultYarleOptions: YarleOptions = {
	enexSources: ['notebook.enex'],
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

	console.log(`Current config is: ${JSON.stringify(yarleOptions, null, 4)}`);
	console.log(`Path separator:${path.sep}`);
	/*}*/
};

interface TaskGroups {
	[key: string]: Map<string, string>;
}

export interface ImportResult {
	total: number,
	failed: number,
	skipped: number
}

export const parseStream = async (options: YarleOptions, enexSource: string): Promise<ImportResult> => {
	console.log(`Getting stream from ${enexSource}`);
	const stream = fs.createReadStream(enexSource);
	let noteNumber = 0;
	let failed = 0;
	let skipped = 0;
	const tasks: TaskGroups = {}; // key: taskId value: generated md text
	const notebookName = utils.getNotebookName(enexSource);

	return new Promise((resolve, reject) => {

		const logAndReject = (error: Error) => {
			console.log(`Could not convert ${enexSource}:\n${error.message}`);
			++failed;

			return reject();
		};
		if (!fs.existsSync(enexSource)) {
			return console.log(JSON.stringify({ name: 'NoSuchFileOrDirectory', message: 'source Enex file does not exists' }));
		}

		const xml = flow(stream);

		let noteAttributes: any = null;
		xml.on('tag:note-attributes', (na: any) => {
			noteAttributes = na;
		});

		xml.on('tag:note', (note: any) => {
			if (options.skipWebClips && isWebClip(note)) {
				++skipped;
				console.log(`Notes skipped: ${skipped}`);
			}
			else {
				if (noteAttributes) {
					// make sure single attributes are not collapsed
					note['note-attributes'] = noteAttributes;
				}

				++noteNumber;

				try {
					processNode(note, notebookName);
					console.log(`Notes processed: ${noteNumber}\n\n`);
				} catch (e) {
					++failed;
					return;
				}
			}
			noteAttributes = null;

			const runtimeProps = RuntimePropertiesSingleton.getInstance();
			const currentNotePath = runtimeProps.getCurrentNotePath();
			if (currentNotePath) {
				for (const task of Object.keys(tasks)) {

					const taskPlaceholder = `<YARLE-EN-V10-TASK>${task}</YARLE-EN-V10-TASK>`
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

		xml.on('end', () => {
			const success = noteNumber - failed;
			const totalNotes = noteNumber + skipped;
			console.log('==========================');
			console.log(
				`Conversion finished: ${success} succeeded, ${skipped} skipped, ${failed} failed. Total notes: ${totalNotes}`,
			);

			return resolve({
				total: noteNumber,
				failed,
				skipped

			});
		});
		xml.on('error', logAndReject);
		stream.on('error', logAndReject);
	});
};

export const dropTheRope = async (options: YarleOptions): Promise<ImportResult> => {
	setOptions(options);
	const outputNotebookFolders = [];
	let results = {
		total: 0,
		failed: 0,
		skipped: 0
	};

	for (const enex of options.enexSources) {
		utils.setPaths(enex);
		const runtimeProps = RuntimePropertiesSingleton.getInstance();
		runtimeProps.setCurrentNotebookName(utils.getNotebookName(enex));
		let enexResults = await parseStream(options, enex);
		results.total += enexResults.total;
		results.failed += enexResults.failed;
		results.skipped += enexResults.skipped;
		outputNotebookFolders.push(utils.getNotesPath());
	}

	await applyLinks(options, outputNotebookFolders);

	return results;

};
