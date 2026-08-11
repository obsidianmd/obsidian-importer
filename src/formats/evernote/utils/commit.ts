import { moment } from 'obsidian';

import { formatMarkdown } from '../../../markdown-output';
import { EvernoteRun } from '../run';

/**
 * Put everything the import converted where it decided it goes.
 *
 * The resource folders are emptied first, which is what a re-import has always
 * done to a note's attachments. Nothing has been written before this, so a
 * note being left alone left its attachments alone too.
 */
export const commit = async (run: EvernoteRun): Promise<void> => {
	for (const folder of run.foldersToEmpty) {
		await run.output.removeFolder(folder);
	}

	for (const resource of run.resources) {
		await run.output.write(resource.path, resource.data, resource.times);
	}

	for (const draft of run.drafts) {
		await run.output.write(draft.path, formatMarkdown(draft.markdown, run.markdownOutput), {
			ctime: moment(draft.note.created).valueOf() || undefined,
			mtime: moment(draft.note.updated).valueOf() || undefined,
		});
	}
};
