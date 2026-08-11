import { moment } from 'obsidian';

import { EvernoteNote, joinNoteContent } from './models/EvernoteNote';
import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { EvernoteRun } from './run';
import { getMetadata, getTags, isComplex } from './utils';

import { renderNote } from './utils/render-note';
import { standardizeFrontMatter } from './utils/front-matter';

/** When the export says the note last changed, if it says at all. */
const sourceMtime = (note: EvernoteNote): number | undefined => {
	const updated = note.updated ? moment(note.updated).valueOf() : NaN;

	return Number.isNaN(updated) ? undefined : updated;
};

export const processNode = (run: EvernoteRun, note: EvernoteNote, reportAs: string): boolean => {

	const title = note.title ?? '';
	run.properties.setCurrentNoteName(title);

	// Where the note goes, and whether it is going at all, both settled before
	// anything is converted: a note being left alone leaves its attachments
	// alone too, which it could not do while its resources were written first.
	const notePath = run.output.planNote(run.paths.mdPath, title || 'Untitled', reportAs);
	if (!run.output.willImport(notePath, sourceMtime(note))) return false;

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

		run.draftNote(notePath, standardizeFrontMatter(renderNote(noteData)), note);

		return true;
	}
	catch (e) {
		// Whatever was decoded belongs to a note that is not arriving.
		run.forgetPendingResources();
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
};
