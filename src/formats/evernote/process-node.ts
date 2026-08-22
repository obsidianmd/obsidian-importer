import { EvernoteNote, joinNoteContent } from './models/EvernoteNote';
import { convertHtml2Md } from './convert-html-to-md';
import { NoteData } from './models/NoteData';
import { extractDataUrlResources, processResources } from './process-resources';
import { EvernoteRun } from './run';
import { getMetadata, isComplex, logTags } from './utils';
import { normalizeTitle } from './utils/filename-utils';
import { noteTimes } from './utils/note-times';

import { renderNote } from './utils/render-note';

export const processNode = async (run: EvernoteRun, note: EvernoteNote, reportAs: string): Promise<boolean> => {

	const title = note.title ?? '';
	run.properties.setCurrentNoteName(title);

	// Preflight before decoding attachments.
	const times = noteTimes(note);
	const notePath = await run.output.planNote(run.mdPath, title || 'Untitled', reportAs);
	run.notePlanned(normalizeTitle(title), notePath);

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

		run.draftNote({ path: notePath, markdown: renderNote(noteData), times });

		return true;
	}
	catch (e) {
		run.forgetPendingResources();
		console.error(`Failed to convert note: ${noteData.title}`, e);
		throw e;
	}
};
