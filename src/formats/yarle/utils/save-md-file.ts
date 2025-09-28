import { RuntimePropertiesSingleton } from '../runtime-properties';
import { Note } from '../schemas/note';
import { writeFile } from './file-utils';
import { getMdFilePath } from './folder-utils';

export const saveMdFile = (data: string, note: Note) => {
	const absMdFilePath = getMdFilePath(note);
	const runtimeProps = RuntimePropertiesSingleton.getInstance();
	runtimeProps.setCurrentNotePath(absMdFilePath);
	writeFile(absMdFilePath, data, note);
	console.log(`Note saved to ${absMdFilePath}`);
};
