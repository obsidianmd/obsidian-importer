import { path } from '../../../filesystem';

import { EvernoteRun } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';

/**
 * Turn every evernote:// link into the note it points at.
 *
 * A note can link to one in a notebook that has not been read yet, so this
 * runs once the whole import has been converted - over the drafts, which is
 * every note the import is writing and nothing else.
 */
export const applyLinks = (run: EvernoteRun): void => {
	const entries = Object.entries(run.properties.getAllNoteIdNameMap());
	if (entries.length === 0) return;

	for (const draft of run.drafts) {
		const notebookFolder = path.dirname(draft.path);
		let updatedContent = draft.markdown;

		for (const [linkName, linkProps] of entries) {
			const { title, notebookName } = linkProps;

			const replacement = notebookName && !notebookFolder.endsWith(notebookName)
				? `${notebookName}/${title}`
				: title;

			updatedContent = updatedContent.replace(new RegExp(escapeStringRegexp(linkName), 'g'), replacement);
		}

		draft.markdown = updatedContent;
	}
};
