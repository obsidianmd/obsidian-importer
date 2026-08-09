import { EvernoteNote } from '../models/EvernoteNote';
import { fs } from '../../../filesystem';
import { formatMarkdown } from '../../../markdown-output';
import { getMarkdownOutput, trackMarkdownWrite } from '../options';

import { setFileDates } from './content-utils';

export const writeFile = (absFilePath: string, data: string, note: EvernoteNote): void => {
	try {
		fs.writeFileSync(absFilePath, formatMarkdown(data, getMarkdownOutput()));
		trackMarkdownWrite(absFilePath);
		setFileDates(absFilePath, note);
	}
	catch (e) {
		console.error('Cannot write file ', e);
		throw e;
	}
};

/** Rewrite a note while preserving its source timestamps. */
export const rewriteFile = (absFilePath: string, data: string): void => {
	let dates: { atime: Date, mtime: Date } | null = null;
	try {
		const stat = fs.statSync(absFilePath);
		dates = { atime: stat.atime, mtime: stat.mtime };
	}
	catch {
		// Best effort.
	}

	fs.writeFileSync(absFilePath, data);
	trackMarkdownWrite(absFilePath);

	if (!dates) return;
	try {
		fs.utimesSync(absFilePath, dates.atime, dates.mtime);
	}
	catch {
		// Best effort.
	}
};
