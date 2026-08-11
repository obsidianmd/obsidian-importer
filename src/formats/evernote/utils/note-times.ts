import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { FileTimes } from '../output';

export const noteTimes = (note: EvernoteNote): FileTimes => {
	const ctime = at(note.created);

	// Evernote leaves out <updated> for a note that was never edited.
	return { ctime, mtime: at(note.updated) ?? ctime };
};

function at(when: string | undefined): number | undefined {
	const stamp = when ? moment(when).valueOf() : NaN;

	return Number.isNaN(stamp) || stamp === 0 ? undefined : stamp;
}
