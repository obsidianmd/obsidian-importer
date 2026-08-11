import { fs } from '../../../filesystem';
import { formatMarkdown } from '../../../markdown-output';
import { EvernoteRun, NoteDraft } from '../run';

import { setFileDates } from './content-utils';

export const writeDraft = (run: EvernoteRun, draft: NoteDraft): void => {
	try {
		fs.writeFileSync(draft.path, formatMarkdown(draft.markdown, run.markdownOutput));
		run.trackMarkdownWrite(draft.path);
		setFileDates(draft.path, draft.note);
	}
	catch (e) {
		console.error('Cannot write file ', e);
		throw e;
	}
};
