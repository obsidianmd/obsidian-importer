import { fs, NodePickedFile, path, PickedFile } from '../../../filesystem';
import { genUid } from '../../../util';
import { YarleOptions } from '../options';
import { RuntimePropertiesSingleton } from '../runtime-properties';
import { yarleOptions } from '../yarle';
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

const MAX_PATH = 249;

export const getResourceDir = (dstPath: string, note: any): string => {
	return getNoteName(dstPath, note).replace(/\s/g, '_');
};

export const truncatFileName = (fileName: string, uniqueId: string): string => {

	if (fileName.length <= 11) {
		throw Error('FATAL: note folder directory path exceeds the OS limitation. Please pick a destination closer to the root folder.');
	}

	const fullPath = `${getNotesPath()}${path.sep}${fileName}`;

	return fullPath.length < MAX_PATH ? fileName : `${fileName.slice(0, MAX_PATH - 11)}_${uniqueId}.md`;
};

const truncateFilePath = (note: any, fileName: string, fullFilePath: string): string => {
	const noteIdNameMap = RuntimePropertiesSingleton.getInstance();

	const noteIdMap = noteIdNameMap.getNoteIdNameMapByNoteTitle(normalizeTitle(note.title))[0] || { uniqueEnd: genUid(6) };


	if (fileName.length <= 11) {
		throw Error('FATAL: note folder directory path exceeds the OS limitation. Please pick a destination closer to the root folder.');
	}

	return `${fullFilePath.slice(0, MAX_PATH - 11)}_${noteIdMap.uniqueEnd}.md`;
	// -11 is the nanoid 5 char +_+ the max possible extension of the note (.md vs .html)
};

const getFilePath = (dstPath: string, note: any, extension: string): string => {
	const fileName = getNoteFileName(dstPath, note, extension);
	const fullFilePath = `${dstPath}${path.sep}${normalizeTitle(fileName)}`;

	return fullFilePath.length < MAX_PATH ? fullFilePath : truncateFilePath(note, fileName, fullFilePath);
};

export const getMdFilePath = (note: any): string => {
	return getFilePath(paths.mdPath, note, 'md');
};

export const getJsonFilePath = (note: any): string => {
	return getFilePath(paths.mdPath, note, 'json');
};
export const getHtmlFilePath = (note: any): string => {
	return getFilePath(paths.resourcePath, note, 'html');
};

export const getHtmlFileLink = (note: any): string => {
	const filePath = getHtmlFilePath(note);

	return `.${filePath.slice(paths.resourcePath.lastIndexOf(path.sep))}`;
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

export const getRelativeResourceDir = (note: any): string => {
	const enexFolder = `${path.sep}${yarleOptions.resourcesDir}`;
	if (yarleOptions.haveGlobalResources) {
		return `..${enexFolder}`;
	}

	return yarleOptions.haveEnexLevelResources
		? `.${enexFolder}`
		: `.${enexFolder}${path.sep}${getResourceDir(paths.mdPath, note)}.resources`;
};

export const getAbsoluteResourceDir = (note: any): string => {
	if (yarleOptions.haveGlobalResources) {
		return path.resolve(paths.resourcePath, '..', '..', yarleOptions.resourcesDir);
	}

	return yarleOptions.haveEnexLevelResources
		? paths.resourcePath
		: `${paths.resourcePath}${path.sep}${getResourceDir(paths.mdPath, note)}.resources`;
};

const resourceDirClears = new Map<string, number>();
export const clearResourceDir = (note: any): void => {
	const resPath = getAbsoluteResourceDir(note);
	if (!resourceDirClears.has(resPath)) {
		resourceDirClears.set(resPath, 0);
	}

	const clears = resourceDirClears.get(resPath) || 0;
	// we're sharing a resource dir, so we can can't clean it more than once
	if ((yarleOptions.haveEnexLevelResources || yarleOptions.haveGlobalResources) && clears >= 1) {
		return;
	}

	clearDistDir(resPath);
	resourceDirClears.set(resPath, clears + 1);
};
export const getNotebookNameAndFolderNames = (basename: string): {notebookName: string, notebookFolderNames: string[]} => {
	const notebookFolderNames = basename.split('@@@');

	let notebookName = notebookFolderNames.pop();
	if (!notebookName){
		notebookName = basename;
	}
	return {
		notebookName,
		notebookFolderNames
	}; 
};


export const getNotebookStackedProps = (baseEnex: PickedFile ): NotebookStackProps => {
	if (!(baseEnex instanceof NodePickedFile)) throw new Error('Evernote import currently only works on desktop');

	const { notebookName } =  getNotebookNameAndFolderNames(baseEnex.basename);

	return {
		fullpath: replaceLastOccurrenceInString(baseEnex.fullpath, baseEnex.basename, notebookName || baseEnex.basename),
		basename: notebookName,
	};
	
};

export const getNotebookStackOutputDir = (enex: PickedFile, options: YarleOptions): string => {

	const { notebookFolderNames } =  getNotebookNameAndFolderNames(enex.basename);

	fs.mkdirSync(path.join(options.outputDir, ...notebookFolderNames), { recursive: true });
	return [options.outputDir, ...notebookFolderNames].join(options.pathSeparator);
};

export const setSingleNotebookPaths = (enexSource:PickedFile, yarleOptions: YarleOptions): void => {
	const enexFileBasename = enexSource.basename;
	setPaths(enexFileBasename, yarleOptions);
};

export const setNotebookStackPaths = (notebookStackProperties: NotebookStackProps,  yarleOptions: YarleOptions): void => {
	const enexFileBasename = notebookStackProperties.basename;
	setPaths(enexFileBasename, yarleOptions);

};

export const setPaths = (enexFileBasename: string, yarleOptions: YarleOptions): void => {
	

	const outputDir = path.isAbsolute(yarleOptions.outputDir)
		? yarleOptions.outputDir
		: `${process.cwd()}${path.sep}${yarleOptions.outputDir}`;

	paths.mdPath = `${outputDir}${path.sep}`;
	paths.resourcePath = `${outputDir}${path.sep}${yarleOptions.resourcesDir}`;

	// console.log(`Skip enex filename from output? ${yarleOptions.skipEnexFileNameFromOutputPath}`);
	if (!yarleOptions.skipEnexFileNameFromOutputPath) {
		paths.mdPath = `${paths.mdPath}${enexFileBasename}`;
		// console.log(`mdPath: ${paths.mdPath}`);
		paths.resourcePath = `${outputDir}${path.sep}${enexFileBasename}${path.sep}${yarleOptions.resourcesDir}`;
	}

	fs.mkdirSync(paths.mdPath, { recursive: true });
	if ((!yarleOptions.haveEnexLevelResources && !yarleOptions.haveGlobalResources)) {
		fs.mkdirSync(paths.resourcePath, { recursive: true });
	}
	console.log(`path ${paths.mdPath} created`);
	// clearDistDir(paths.simpleMdPath);
	// clearDistDir(paths.complexMdPath);
};

export const getNotesPath = (): string => {
	return paths.mdPath;
};
