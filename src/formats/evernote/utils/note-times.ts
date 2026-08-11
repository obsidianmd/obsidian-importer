import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { FileTimes } from '../output';

/**
 * When the export says the note was made and last changed.
 *
 * A note's own dates, the dates of everything decoded out of it, and the time
 * an earlier import's copy is compared against are all this one answer.
 */
export const noteTimes = (note: EvernoteNote): FileTimes => ({
	ctime: at(note.created),
	mtime: at(note.updated),
});

function at(when: string | undefined): number | undefined {
	const stamp = when ? moment(when).valueOf() : NaN;

	return Number.isNaN(stamp) || stamp === 0 ? undefined : stamp;
}
