import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { RuntimePropertiesSingleton } from './runtime-properties';
import { getMetadata, getTags, isComplex, saveMdFile } from './utils';

import { applyTemplate } from './utils/templates/templates';
import { yarleOptions } from './yarle';

export const processNode = (note: any, notebookName: string): void => {

	const dateStarted: Date = new Date();

	const runtimeProps = RuntimePropertiesSingleton.getInstance();
	runtimeProps.setCurrentNoteName(note.title);

	if (Array.isArray(note.content)) {
		note.content = note.content.join('');
	}
	let noteData: NoteData = {
		title: note.title,
		content: note.content,
		htmlContent: note.content,
		originalContent: note.content,
	};

	console.log(`Converting for note "${noteData.title}" started at ${dateStarted}...`);

	try {
		if (isComplex(note)) {
			noteData.htmlContent = processResources(note);
		}
		noteData.htmlContent = extractDataUrlResources(note, noteData.htmlContent);

		noteData = { ...noteData, ...convertHtml2Md(yarleOptions, noteData) };
		noteData = { ...noteData, ...getMetadata(note, notebookName) };
		noteData = { ...noteData, ...getTags(note) };

		const data = applyTemplate(noteData, yarleOptions);
		// console.log(`data =>\n ${JSON.stringify(data)} \n***`);

		saveMdFile(data, note);

		/* if (isTOC(noteData.title)) {
		  const  noteIdNameMap = RuntimePropertiesSingleton.getInstance();
		  noteIdNameMap.extendNoteIdNameMap(noteData);
		}*/

	}
	catch (e) {
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
	finally {
		const dateFinished: Date = new Date();
		const conversionDuration = (dateFinished.getTime() - dateStarted.getTime()) / 1000; // in seconds.
		console.log(`Conversion for note "${noteData.title}" finished at ${dateFinished}. Took ${conversionDuration} seconds`);
	}
};
