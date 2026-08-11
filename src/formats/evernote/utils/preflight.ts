import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { EvernoteRun } from '../run';

/**
 * Whether this note is being imported at all, given what is at its path.
 *
 * Asked before the note is converted and before a single attachment is
 * decoded, so a note the import is leaving alone costs nothing and - more to
 * the point - touches nothing.
 */
export const willImport = (run: EvernoteRun, notePath: string, note: EvernoteNote): boolean => {
	const writtenAt = whenWritten(run, notePath);
	if (writtenAt === null) return true;

	const updated = note.updated ? moment(note.updated).valueOf() : NaN;

	return run.decideExistingNote({
		absolutePath: notePath,
		writtenAt,
		updatedAt: Number.isNaN(updated) ? null : updated,
	}) === 'write';
};

/** When the note at this path was last written, by this run or an earlier one. */
function whenWritten(run: EvernoteRun, notePath: string): number | null {
	return run.claimedAt(notePath) ?? run.output.writtenAt(notePath);
}
