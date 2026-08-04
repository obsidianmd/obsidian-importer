import { EvernoteNote } from '../models/EvernoteNote';
import { fs } from '../../../filesystem';

import { setFileDates } from './content-utils';

export const writeFile = (absFilePath: string, data: string, note: EvernoteNote): void => {
	try {
		fs.writeFileSync(absFilePath, data);
		setFileDates(absFilePath, note);
	}
	catch (e) {
		console.error('Cannot write file ', e);
		throw e;
	}
};
