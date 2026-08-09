import { moment } from 'obsidian';

import { EvernoteNote } from '../models/EvernoteNote';
import { fs } from '../../../filesystem';
import { decideExistingNote, noteWasWritten } from '../options';
import { RuntimePropertiesSingleton } from '../runtime-properties';
import { writeFile } from './file-utils';
import { getMdFilePath } from './folder-utils';

/**
 * Write the note, unless the importer says a note already at that path should
 * be left as it is. Returns false for a note it left alone, which the import
 * counts as skipped rather than imported.
 */
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
		// Nothing readable there to leave alone.
		return true;
	}

	const updated = note.updated ? moment(note.updated).valueOf() : NaN;

	return decideExistingNote({
		absolutePath: absMdFilePath,
		writtenAt,
		updatedAt: Number.isNaN(updated) ? null : updated,
	}) === 'write';
}
