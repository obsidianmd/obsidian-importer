import { fs } from '../../../filesystem';
import { Note } from '../schemas/note';

import { setFileDates } from './content-utils';

export const writeFile = (absFilePath: string, data: string, note: Note): void => {
	try {
		fs.writeFileSync(absFilePath, data);
		setFileDates(absFilePath, note);
	}
	catch (e) {
		console.error('Cannot write file ', e);
		throw e;
	}
};
