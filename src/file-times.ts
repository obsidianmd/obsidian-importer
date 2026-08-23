import { fsPromises, NodePickedFile, PickedFile } from './filesystem';
import { ZipEntryFile } from './zip';

export interface FileTimes {
	ctime: number;
	mtime: number;
}

export async function pickedFileTimes(file: PickedFile): Promise<FileTimes | undefined> {
	if (file instanceof ZipEntryFile) {
		const modified = file.mtime ?? file.ctime;
		if (!modified) return undefined;
		return {
			ctime: (file.ctime ?? modified).getTime(),
			mtime: modified.getTime(),
		};
	}

	if (!(file instanceof NodePickedFile)) return undefined;

	try {
		const stat = await fsPromises.stat(file.filepath);
		return {
			ctime: Math.round(stat.birthtimeMs || stat.ctimeMs),
			mtime: Math.round(stat.mtimeMs),
		};
	}
	catch {
		return undefined;
	}
}
