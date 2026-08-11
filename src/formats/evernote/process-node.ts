import { EvernoteNote, joinNoteContent } from './models/EvernoteNote';
import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { EvernoteRun } from './run';
import { getMetadata, getTags, isComplex, saveMdFile } from './utils';

import { renderNote } from './utils/render-note';
import { standardizeFrontMatter } from './utils/front-matter';

export const processNode = (run: EvernoteRun, note: EvernoteNote): boolean => {

	const title = note.title ?? '';
	run.properties.setCurrentNoteName(title);

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
			noteData.htmlContent = processResources(run, note);
		}
		noteData.htmlContent = extractDataUrlResources(run, note, noteData.htmlContent);

		noteData = { ...noteData, ...convertHtml2Md(run, noteData) };
		noteData = { ...noteData, ...getMetadata(run, note) };
		noteData = { ...noteData, ...getTags(run, note) };

		const data = standardizeFrontMatter(renderNote(noteData));

		return saveMdFile(run, data, note);
	}
	catch (e) {
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
};
