import { EvernoteNote } from '../models/EvernoteNote';
import { fs, NodePickedFile, path, PickedFile } from '../../../filesystem';
import { genUid, sanitizeFileName } from '../../../util';
import { EvernoteRun } from '../run';
import { replaceLastOccurrenceInString } from './string-utils';

import { getNoteFileName, getNoteName, normalizeTitle } from './filename-utils';

export interface NotebookStackProps {
	fullpath: string;
	basename: string;
}

// Path length constants
const MAX_PATH = 249; // Maximum path length for compatibility
const MAX_ENEX_DIR_LENGTH = 100; // Conservative limit for enex directory name

/**
 * Check if a path exists and add (1), (2), etc. suffix if needed to avoid conflicts
 * @param basePath - The directory path where the item will be created
 * @param name - The desired name (without path)
 * @param suffix - Optional suffix to append (e.g., '.resources')
 * @returns A unique name that doesn't conflict with existing items
 */
const getUniqueNameForPath = (run: EvernoteRun, basePath: string, name: string, suffix: string = ''): string => {
	if (run.reusesNoteNames()) return name;

	const baseName = name;
	let uniqueName = name;
	let counter = 1;
	let fullPath = `${basePath}/${uniqueName}${suffix}`;

	while (fs.existsSync(fullPath)) {
		uniqueName = `${baseName} (${counter})`;
		fullPath = `${basePath}/${uniqueName}${suffix}`;
		counter++;

		// Safety check to prevent infinite loop
		if (counter > 9999) {
			throw new Error(`Too many duplicate items with name: ${name}`);
		}
	}

	return uniqueName;
};

export const getResourceDir = (run: EvernoteRun, note: EvernoteNote): string => {
	// Note name is already limited by MAX_NOTE_NAME_LENGTH in getNoteName()
	const dirName = getNoteName(run, run.paths.mdPath, note).replace(/\s/g, '_');
	return getUniqueNameForPath(run, run.paths.resourcePath, dirName, '.resources');
};

export const truncatFileName = (run: EvernoteRun, fileName: string, uniqueId: string): string => {

	if (fileName.length <= 11) {
		throw Error('FATAL: note folder directory path exceeds the OS limitation. Please pick a destination closer to the root folder.');
	}

	const fullPath = `${run.paths.mdPath}/${fileName}`;

	return fullPath.length < MAX_PATH ? fileName : `${fileName.slice(0, MAX_PATH - 11)}_${uniqueId}.md`;
};

const truncateFilePath = (run: EvernoteRun, note: EvernoteNote, fileName: string, fullFilePath: string): string => {
	const noteIdMap = run.properties.getNoteIdNameMapByNoteTitle(normalizeTitle(note.title ?? ''))[0] || { uniqueEnd: genUid(6) };


	if (fileName.length <= 11) {
		throw Error('FATAL: note folder directory path exceeds the OS limitation. Please pick a destination closer to the root folder.');
	}

	return `${fullFilePath.slice(0, MAX_PATH - 11)}_${noteIdMap.uniqueEnd}.md`;
	// -11 is the nanoid 5 char +_+ the max possible extension of the note (.md vs .html)
};

export const getMdFilePath = (run: EvernoteRun, note: EvernoteNote): string => {
	const dstPath = run.paths.mdPath;
	const fileName = getNoteFileName(run, dstPath, note, 'md');
	const fullFilePath = `${dstPath}/${normalizeTitle(fileName)}`;

	return fullFilePath.length < MAX_PATH ? fullFilePath : truncateFilePath(run, note, fileName, fullFilePath);
};


const clearDistDir = (dstPath: string): void => {
	if (fs.existsSync(dstPath)) {
		if (fs.rmSync) {
			fs.rmSync(dstPath, { recursive: true, force: true });
		}
		else {
			fs.rmdirSync(dstPath, { recursive: true });
		}
	}
	fs.mkdirSync(dstPath);
};

export const getRelativeResourceDir = (run: EvernoteRun, note: EvernoteNote): string => {
	return `./${run.options.resourcesDir}/${getResourceDir(run, note)}.resources`;
};

export const getAbsoluteResourceDir = (run: EvernoteRun, note: EvernoteNote): string => {
	return `${run.paths.resourcePath}/${getResourceDir(run, note)}.resources`;
};

export const clearResourceDir = (run: EvernoteRun, note: EvernoteNote): void => {
	clearDistDir(getAbsoluteResourceDir(run, note));
};
export const getNotebookNameAndFolderNames = (basename: string): { notebookName: string, notebookFolderNames: string[] } => {
	const notebookFolderNames = basename.split('@@@');

	let notebookName = notebookFolderNames.pop();
	if (!notebookName) {
		notebookName = basename;
	}
	return {
		notebookName,
		notebookFolderNames
	};
};

export const getSanitizedNotebookFolderNames = (basename: string): string[] => {
	const { notebookFolderNames } = getNotebookNameAndFolderNames(basename);

	return notebookFolderNames.map(name => sanitizeFileName(name));
};

export const getNotebookStackedProps = (baseEnex: PickedFile): NotebookStackProps => {
	if (!(baseEnex instanceof NodePickedFile)) throw new Error('Evernote import currently only works on desktop');

	const { notebookName } = getNotebookNameAndFolderNames(baseEnex.basename);

	return {
		fullpath: replaceLastOccurrenceInString(baseEnex.fullpath, baseEnex.basename, notebookName || baseEnex.basename),
		basename: notebookName,
	};

};

export const getNotebookStackOutputDir = (enex: PickedFile, outputDir: string): string => {

	const notebookFolderNames = getSanitizedNotebookFolderNames(enex.basename);

	fs.mkdirSync(path.join(outputDir, ...notebookFolderNames), { recursive: true });
	return [outputDir, ...notebookFolderNames].join('/');
};

export const setPaths = (run: EvernoteRun, enexFileBasename: string, outputDir: string): void => {
	const base = path.isAbsolute(outputDir)
		? outputDir
		: `${process.cwd()}/${outputDir}`;

	let truncatedBasename = sanitizeFileName(enexFileBasename);

	if (truncatedBasename.length > MAX_ENEX_DIR_LENGTH) {
		truncatedBasename = sanitizeFileName(truncatedBasename.substring(0, MAX_ENEX_DIR_LENGTH));
		console.warn(`ENEX filename too long (${enexFileBasename.length} chars), truncated to ${MAX_ENEX_DIR_LENGTH} chars: ${truncatedBasename}`);
	}

	// Check for duplicate directory names and add (1), (2), etc. if needed
	truncatedBasename = getUniqueNameForPath(run, base, truncatedBasename);

	run.paths.mdPath = `${base}/${truncatedBasename}`;
	run.paths.resourcePath = `${base}/${truncatedBasename}/${run.options.resourcesDir}`;

	fs.mkdirSync(run.paths.mdPath, { recursive: true });
	fs.mkdirSync(run.paths.resourcePath, { recursive: true });
};
