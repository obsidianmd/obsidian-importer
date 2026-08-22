import { AndroidPickedFile, fsPromises, NodePickedFile, PickedFile } from './filesystem';
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

	if (file instanceof AndroidPickedFile) {
		const ctime = file.ctime ?? file.mtime;
		const mtime = file.mtime ?? file.ctime;
		if (ctime === undefined || mtime === undefined || !Number.isFinite(ctime) || !Number.isFinite(mtime)) {
			return undefined;
		}
		return { ctime: Math.round(ctime), mtime: Math.round(mtime) };
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
