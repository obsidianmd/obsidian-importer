import { EvernoteNote, joinNoteContent } from './models/EvernoteNote';
import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { RuntimePropertiesSingleton } from './runtime-properties';
import { getMetadata, getTags, isComplex, saveMdFile } from './utils';

import { applyTemplate } from './utils/templates/templates';
import { standardizeFrontMatter } from './utils/front-matter';
import { evernoteOptions } from './convert';

export const processNode = (note: EvernoteNote, notebookName: string): boolean => {

	const runtimeProps = RuntimePropertiesSingleton.getInstance();
	const title = note.title ?? '';
	runtimeProps.setCurrentNoteName(title);

	const content = joinNoteContent(note.content);
	note.content = content;

	let noteData: NoteData = {
		title,
		content,
		htmlContent: content,
		originalContent: content,
	};


	try {
		if (isComplex(note)) {
			noteData.htmlContent = processResources(note);
		}
		noteData.htmlContent = extractDataUrlResources(note, noteData.htmlContent);

		noteData = { ...noteData, ...convertHtml2Md(evernoteOptions, noteData) };
		noteData = { ...noteData, ...getMetadata(note, notebookName) };
		noteData = { ...noteData, ...getTags(note) };

		const data = standardizeFrontMatter(applyTemplate(noteData, evernoteOptions));
		// console.log(`data =>\n ${JSON.stringify(data)} \n***`);

		return saveMdFile(data, note);

		/* if (isTOC(noteData.title)) {
		  const  noteIdNameMap = RuntimePropertiesSingleton.getInstance();
		  noteIdNameMap.extendNoteIdNameMap(noteData);
		}*/

	}
	catch (e) {
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
};
