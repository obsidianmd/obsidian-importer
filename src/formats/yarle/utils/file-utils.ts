import { EvernoteNote } from '../models/EvernoteNote';
import { fs } from '../../../filesystem';
import { formatMarkdown } from '../../../markdown-output';
import { getMarkdownOutput } from '../options';

import { setFileDates } from './content-utils';

export const writeFile = (absFilePath: string, data: string, note: EvernoteNote): void => {
	try {
		fs.writeFileSync(absFilePath, formatMarkdown(data, getMarkdownOutput()));
		setFileDates(absFilePath, note);
	}
	catch (e) {
		console.error('Cannot write file ', e);
		throw e;
	}
};
