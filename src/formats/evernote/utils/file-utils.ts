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

/**
 * Rewrite a note this import already wrote, keeping the times setFileDates gave
 * it. Links and tasks are settled in later passes, and without this every note
 * touched by one would carry the time of the import rather than the time the
 * source last changed - which a later import reads as a note edited in Obsidian
 * and then refuses to update, for good.
 */
export const rewriteFile = (absFilePath: string, data: string): void => {
	let dates: { atime: Date, mtime: Date } | null = null;
	try {
		const stat = fs.statSync(absFilePath);
		dates = { atime: stat.atime, mtime: stat.mtime };
	}
	catch {
		// Nothing there to preserve; the write below reports its own failure.
	}

	fs.writeFileSync(absFilePath, data);
	trackMarkdownWrite(absFilePath);

	if (!dates) return;
	try {
		fs.utimesSync(absFilePath, dates.atime, dates.mtime);
	}
	catch {
		// Timestamps are best effort, as they are in setFileDates.
	}
};
