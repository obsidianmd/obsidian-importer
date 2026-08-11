import { path } from '../../../filesystem';

import { EvernoteRun } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';
import { truncatFileName } from './folder-utils';

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
			const uniqueId = linkProps.uniqueEnd;
			let fileName = linkProps.title;
			if (run.drafts.some(other => other.path.includes(uniqueId))) {
				fileName = truncatFileName(run, fileName, uniqueId);
			}

			const notebookName = linkProps.notebookName;

			let replacement = fileName;
			if (notebookName && !notebookFolder.endsWith(notebookName)) {
				replacement = `${notebookName}/${fileName}`;
			}

			const regexp = new RegExp(escapeStringRegexp(linkName), 'g');
			updatedContent = updatedContent.replace(regexp, replacement);
		}

		draft.markdown = updatedContent;
	}
};
