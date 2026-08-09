import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { fs } from '../../../filesystem';
import { decideExistingNote, noteWasWritten } from '../options';
import { RuntimePropertiesSingleton } from '../runtime-properties';
import { writeFile } from './file-utils';
import { getMdFilePath } from './folder-utils';

export const saveMdFile = (data: string, note: EvernoteNote): boolean => {
	const absMdFilePath = getMdFilePath(note);

	if (!shouldWrite(absMdFilePath, note)) return false;

	const runtimeProps = RuntimePropertiesSingleton.getInstance();
	runtimeProps.setCurrentNotePath(absMdFilePath);
	writeFile(absMdFilePath, data, note);
	noteWasWritten(absMdFilePath);

	return true;
};

function shouldWrite(absMdFilePath: string, note: EvernoteNote): boolean {
	let writtenAt: number;
	try {
		if (!fs.existsSync(absMdFilePath)) return true;
		writtenAt = fs.statSync(absMdFilePath).mtimeMs;
	}
	catch {
		return true;
	}

	const updated = note.updated ? moment(note.updated).valueOf() : NaN;

	return decideExistingNote({
		absolutePath: absMdFilePath,
		writtenAt,
		updatedAt: Number.isNaN(updated) ? null : updated,
	}) === 'write';
}
