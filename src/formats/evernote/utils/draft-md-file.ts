import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { EvernoteRun } from '../run';
import { getMdFilePath } from './folder-utils';

/**
 * Settle where the note goes and hold it there until the import is committed.
 *
 * Answers whether the note is being imported at all: a note the user has asked
 * to leave alone never takes a path, so the next note of that title does not
 * skip a number.
 */
export const draftMdFile = (run: EvernoteRun, data: string, note: EvernoteNote): boolean => {
	const absMdFilePath = getMdFilePath(run, note);

	if (!shouldWrite(run, absMdFilePath, note)) return false;

	run.draftNote(absMdFilePath, data, note);

	return true;
};

function shouldWrite(run: EvernoteRun, absMdFilePath: string, note: EvernoteNote): boolean {
	const writtenAt = whenWritten(run, absMdFilePath);
	if (writtenAt === null) return true;

	const updated = note.updated ? moment(note.updated).valueOf() : NaN;

	return run.decideExistingNote({
		absolutePath: absMdFilePath,
		writtenAt,
		updatedAt: Number.isNaN(updated) ? null : updated,
	}) === 'write';
}

/** When the note at this path was last written, by this run or an earlier one. */
function whenWritten(run: EvernoteRun, absMdFilePath: string): number | null {
	return run.claimedAt(absMdFilePath) ?? run.output.writtenAt(absMdFilePath);
}
