import { parseFilePath } from '../../../filesystem';
import { EvernoteRun } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';

/** Resolve Evernote links by title; ENEX does not expose target IDs on notes. */
const EVERNOTE_URL = 'evernote://';

export const applyLinks = (run: EvernoteRun): void => {
	const entries = Object.entries(run.properties.getAllNoteIdNameMap());
	if (entries.length === 0) return;

	const links = entries.map(([url, { title, notebookName }]) => ({
		url: new RegExp(escapeStringRegexp(url), 'g'),
		target: run.plannedNote(title),
		title,
		notebookName,
	}));

	for (const draft of run.drafts) {
		if (!draft.markdown.includes(EVERNOTE_URL)) continue;

		const from = parseFilePath(draft.path).parent;
		let updatedContent = draft.markdown;

		for (const { url, target, title, notebookName } of links) {
			const to = target
				? linkToNote(target, from)
				: notebookName && !from.endsWith(notebookName) ? `${notebookName}/${title}` : title;

			// Preserve the display title when the target includes a folder.
			updatedContent = updatedContent.replace(url, to === title ? title : `${to}|${title}`);
		}

		draft.markdown = updatedContent;
	}
};

function linkToNote(path: string, from: string): string {
	const { parent, basename } = parseFilePath(path);
	const name = basename.replace(/[[\]#^|]/g, '');

	return parent === from ? name : `${parseFilePath(parent).name}/${name}`;
}
