import * as fs from 'fs';
import { logger } from './../utils/logger';

import { setFileDates } from './content-utils';

export const writeFile = (absFilePath: string, data: any, note: any): void => {
	try {
		fs.writeFileSync(absFilePath, data);
		setFileDates(absFilePath, note);
	} catch (e) {
		// tslint:disable-next-line: no-console
		logger.error('Cannot write file ', e);
		throw e;
	}
};
