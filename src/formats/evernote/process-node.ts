import { EvernoteNote, joinNoteContent } from './models/EvernoteNote';
import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { EvernoteRun } from './run';
import { getMetadata, isComplex, logTags } from './utils';
import { noteTimes } from './utils/note-times';

import { renderNote } from './utils/render-note';

export const processNode = (run: EvernoteRun, note: EvernoteNote, reportAs: string): boolean => {

	const title = note.title ?? '';
	run.properties.setCurrentNoteName(title);

	// Where the note goes, and whether it is going at all, both settled before
	// anything is converted: a note being left alone leaves its attachments
	// alone too, which it could not do while its resources were written first.
	const times = noteTimes(note);
	const notePath = run.output.planNote(run.mdPath, title || 'Untitled', reportAs);
	if (!run.output.willImport(notePath, times.mtime)) return false;

	const content = joinNoteContent(note.content);
	note.content = content;

	let noteData: NoteData = {
		title,
		content,
		htmlContent: content,
	};


	try {
		if (isComplex(note)) {
			noteData.htmlContent = processResources(run, note);
		}
		noteData.htmlContent = extractDataUrlResources(run, note, noteData.htmlContent);

		noteData = { ...noteData, ...convertHtml2Md(run, noteData) };
		noteData = { ...noteData, ...getMetadata(run, note) };
		noteData.tags = logTags(run, note);

		run.draftNote({
			path: notePath,
			markdown: renderNote(noteData),
			title,
			times,
		});

		return true;
	}
	catch (e) {
		// Whatever was decoded belongs to a note that is not arriving.
		run.forgetPendingResources();
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
};
