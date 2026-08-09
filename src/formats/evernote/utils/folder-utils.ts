import { EvernoteNote } from '../models/EvernoteNote';
import { fs, NodePickedFile, path, PickedFile } from '../../../filesystem';
import { genUid, sanitizeFileName } from '../../../util';
import { EvernoteOptions, reusesNoteNames } from '../options';
import { RuntimePropertiesSingleton } from '../runtime-properties';
import { evernoteOptions } from '../convert';
import { replaceLastOccurrenceInString } from './string-utils';

import { getNoteFileName, getNoteName, normalizeTitle } from './filename-utils';

export interface Path {
	mdPath: string;
	resourcePath: string;
}

export const paths: Path = {
	mdPath: '',
	resourcePath: '',
};
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
const getUniqueNameForPath = (basePath: string, name: string, suffix: string = ''): string => {
	// The note keeping its name means its resources keep their folder too,
	// rather than a "Note (1).resources" piling up beside it on every run.
	if (reusesNoteNames()) return name;

	const baseName = name;
	let uniqueName = name;
	let counter = 1;
	let fullPath = `${basePath}${path.sep}${uniqueName}${suffix}`;

	while (fs.existsSync(fullPath)) {
		uniqueName = `${baseName} (${counter})`;
		fullPath = `${basePath}${path.sep}${uniqueName}${suffix}`;
		counter++;

		// Safety check to prevent infinite loop
		if (counter > 9999) {
			throw new Error(`Too many duplicate items with name: ${name}`);
		}
	}

	return uniqueName;
};

export const getResourceDir = (dstPath: string, note: EvernoteNote): string => {
	// Note name is already limited by MAX_NOTE_NAME_LENGTH in getNoteName()
	const dirName = getNoteName(dstPath, note).replace(/\s/g, '_');
	return getUniqueNameForPath(paths.resourcePath, dirName, '.resources');
};

export const truncatFileName = (fileName: string, uniqueId: string): string => {

	if (fileName.length <= 11) {
		throw Error('FATAL: note folder directory path exceeds the OS limitation. Please pick a destination closer to the root folder.');
	}

	const fullPath = `${getNotesPath()}${path.sep}${fileName}`;

	return fullPath.length < MAX_PATH ? fileName : `${fileName.slice(0, MAX_PATH - 11)}_${uniqueId}.md`;
};

const truncateFilePath = (note: EvernoteNote, fileName: string, fullFilePath: string): string => {
	const noteIdNameMap = RuntimePropertiesSingleton.getInstance();

	const noteIdMap = noteIdNameMap.getNoteIdNameMapByNoteTitle(normalizeTitle(note.title ?? ''))[0] || { uniqueEnd: genUid(6) };


	if (fileName.length <= 11) {
		throw Error('FATAL: note folder directory path exceeds the OS limitation. Please pick a destination closer to the root folder.');
	}

	return `${fullFilePath.slice(0, MAX_PATH - 11)}_${noteIdMap.uniqueEnd}.md`;
	// -11 is the nanoid 5 char +_+ the max possible extension of the note (.md vs .html)
};

const getFilePath = (dstPath: string, note: EvernoteNote, extension: string): string => {
	const fileName = getNoteFileName(dstPath, note, extension);
	const fullFilePath = `${dstPath}${path.sep}${normalizeTitle(fileName)}`;

	return fullFilePath.length < MAX_PATH ? fullFilePath : truncateFilePath(note, fileName, fullFilePath);
};

export const getMdFilePath = (note: EvernoteNote): string => {
	return getFilePath(paths.mdPath, note, 'md');
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

export const getRelativeResourceDir = (note: EvernoteNote): string => {
	const enexFolder = `${path.sep}${evernoteOptions.resourcesDir}`;
	if (evernoteOptions.haveGlobalResources) {
		return `..${enexFolder}`;
	}

	return evernoteOptions.haveEnexLevelResources
		? `.${enexFolder}`
		: `.${enexFolder}${path.sep}${getResourceDir(paths.mdPath, note)}.resources`;
};

export const getAbsoluteResourceDir = (note: EvernoteNote): string => {
	if (evernoteOptions.haveGlobalResources) {
		return path.resolve(paths.resourcePath, '..', '..', evernoteOptions.resourcesDir);
	}

	return evernoteOptions.haveEnexLevelResources
		? paths.resourcePath
		: `${paths.resourcePath}${path.sep}${getResourceDir(paths.mdPath, note)}.resources`;
};

const resourceDirClears = new Map<string, number>();
export const clearResourceDir = (note: EvernoteNote): void => {
	const resPath = getAbsoluteResourceDir(note);
	if (!resourceDirClears.has(resPath)) {
		resourceDirClears.set(resPath, 0);
	}

	const clears = resourceDirClears.get(resPath) || 0;
	// we're sharing a resource dir, so we can can't clean it more than once
	if ((evernoteOptions.haveEnexLevelResources || evernoteOptions.haveGlobalResources) && clears >= 1) {
		return;
	}

	clearDistDir(resPath);
	resourceDirClears.set(resPath, clears + 1);
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

export const getNotebookStackOutputDir = (enex: PickedFile, options: EvernoteOptions): string => {

	const notebookFolderNames = getSanitizedNotebookFolderNames(enex.basename);

	fs.mkdirSync(path.join(options.outputDir, ...notebookFolderNames), { recursive: true });
	return [options.outputDir, ...notebookFolderNames].join(options.pathSeparator);
};

export const setSingleNotebookPaths = (enexSource: PickedFile, evernoteOptions: EvernoteOptions): void => {
	const enexFileBasename = enexSource.basename;
	setPaths(enexFileBasename, evernoteOptions);
};

export const setNotebookStackPaths = (notebookStackProperties: NotebookStackProps, evernoteOptions: EvernoteOptions): void => {
	const enexFileBasename = notebookStackProperties.basename;
	setPaths(enexFileBasename, evernoteOptions);

};

export const setPaths = (enexFileBasename: string, evernoteOptions: EvernoteOptions): void => {


	const outputDir = path.isAbsolute(evernoteOptions.outputDir)
		? evernoteOptions.outputDir
		: `${process.cwd()}${path.sep}${evernoteOptions.outputDir}`;

	paths.mdPath = `${outputDir}${path.sep}`;
	paths.resourcePath = `${outputDir}${path.sep}${evernoteOptions.resourcesDir}`;

	// console.log(`Skip enex filename from output? ${evernoteOptions.skipEnexFileNameFromOutputPath}`);
	if (!evernoteOptions.skipEnexFileNameFromOutputPath) {
		let truncatedBasename = sanitizeFileName(enexFileBasename);

		if (truncatedBasename.length > MAX_ENEX_DIR_LENGTH) {
			truncatedBasename = sanitizeFileName(truncatedBasename.substring(0, MAX_ENEX_DIR_LENGTH));
			console.warn(`ENEX filename too long (${enexFileBasename.length} chars), truncated to ${MAX_ENEX_DIR_LENGTH} chars: ${truncatedBasename}`);
		}

		// Check for duplicate directory names and add (1), (2), etc. if needed
		truncatedBasename = getUniqueNameForPath(outputDir, truncatedBasename);

		paths.mdPath = `${paths.mdPath}${truncatedBasename}`;
		// console.log(`mdPath: ${paths.mdPath}`);
		paths.resourcePath = `${outputDir}${path.sep}${truncatedBasename}${path.sep}${evernoteOptions.resourcesDir}`;
	}

	fs.mkdirSync(paths.mdPath, { recursive: true });
	if ((!evernoteOptions.haveEnexLevelResources && !evernoteOptions.haveGlobalResources)) {
		fs.mkdirSync(paths.resourcePath, { recursive: true });
	}
	// clearDistDir(paths.simpleMdPath);
	// clearDistDir(paths.complexMdPath);
};

export const getNotesPath = (): string => {
	return paths.mdPath;
};
