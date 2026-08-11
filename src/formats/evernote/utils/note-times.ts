import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { FileTimes } from '../output';

export const noteTimes = (note: EvernoteNote): FileTimes => ({
	ctime: at(note.created),
	mtime: at(note.updated),
});

function at(when: string | undefined): number | undefined {
	const stamp = when ? moment(when).valueOf() : NaN;

	return Number.isNaN(stamp) || stamp === 0 ? undefined : stamp;
}
