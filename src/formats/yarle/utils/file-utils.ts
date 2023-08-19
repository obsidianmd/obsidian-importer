import { fs } from '../../../filesystem';

import { setFileDates } from './content-utils';

export const writeFile = (absFilePath: string, data: any, note: any): void => {
	try {
		fs.writeFileSync(absFilePath, data);
		setFileDates(absFilePath, note);
	}
	catch (e) {
		console.error('Cannot write file ', e);
		throw e;
	}
};
