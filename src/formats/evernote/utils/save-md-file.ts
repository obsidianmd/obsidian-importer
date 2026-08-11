import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { fs } from '../../../filesystem';
import { EvernoteRun } from '../run';
import { writeFile } from './file-utils';
import { getMdFilePath } from './folder-utils';

export const saveMdFile = (run: EvernoteRun, data: string, note: EvernoteNote): boolean => {
	const absMdFilePath = getMdFilePath(run, note);

	if (!shouldWrite(run, absMdFilePath, note)) return false;

	run.properties.setCurrentNotePath(absMdFilePath);
	writeFile(run, absMdFilePath, data, note);
	run.noteWasWritten(absMdFilePath);

	return true;
};

function shouldWrite(run: EvernoteRun, absMdFilePath: string, note: EvernoteNote): boolean {
	let writtenAt: number;
	try {
		if (!fs.existsSync(absMdFilePath)) return true;
		writtenAt = fs.statSync(absMdFilePath).mtimeMs;
	}
	catch {
		return true;
	}

	const updated = note.updated ? moment(note.updated).valueOf() : NaN;

	return run.decideExistingNote({
		absolutePath: absMdFilePath,
		writtenAt,
		updatedAt: Number.isNaN(updated) ? null : updated,
	}) === 'write';
}
