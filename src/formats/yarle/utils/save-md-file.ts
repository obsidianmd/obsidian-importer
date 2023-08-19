import { RuntimePropertiesSingleton } from '../runtime-properties';
import { writeFile } from './file-utils';
import { getMdFilePath } from './folder-utils';

export const saveMdFile = (data: any, note: any) => {
	const absMdFilePath = getMdFilePath(note);
	const runtimeProps = RuntimePropertiesSingleton.getInstance();
	runtimeProps.setCurrentNotePath(absMdFilePath);
	writeFile(absMdFilePath, data, note);
	console.log(`Note saved to ${absMdFilePath}`);
};
