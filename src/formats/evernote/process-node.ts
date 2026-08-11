import { EvernoteNote, joinNoteContent } from './models/EvernoteNote';
import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { EvernoteRun } from './run';
import { getMdFilePath, ResourceDirs, resourceDirsFor } from './utils/folder-utils';
import { willImport } from './utils/preflight';
import { getMetadata, getTags, isComplex } from './utils';

import { renderNote } from './utils/render-note';
import { standardizeFrontMatter } from './utils/front-matter';

export const processNode = (run: EvernoteRun, note: EvernoteNote): boolean => {

	const title = note.title ?? '';
	run.properties.setCurrentNoteName(title);

	// Where the note goes, and whether it is going at all, both settled before
	// anything is converted: a note being left alone leaves its attachments
	// alone too, which it could not do while its resources were written first.
	const notePath = getMdFilePath(run, note);
	if (!willImport(run, notePath, note)) return false;

	const content = joinNoteContent(note.content);
	note.content = content;

	let noteData: NoteData = {
		title,
		content,
		htmlContent: content,
		originalContent: content,
	};


	// Asked for once a note, and only by a note with something to put in it:
	// naming the folder is what takes the name.
	let dirs: ResourceDirs | null = null;
	const resourceDirs = () => dirs ??= resourceDirsFor(run, note);

	try {
		if (isComplex(note)) {
			noteData.htmlContent = processResources(run, resourceDirs(), note);
		}
		noteData.htmlContent = extractDataUrlResources(run, resourceDirs, note, noteData.htmlContent);

		noteData = { ...noteData, ...convertHtml2Md(run, noteData) };
		noteData = { ...noteData, ...getMetadata(run, note) };
		noteData = { ...noteData, ...getTags(run, note) };

		run.draftNote(notePath, standardizeFrontMatter(renderNote(noteData)), note);

		return true;
	}
	catch (e) {
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
};
