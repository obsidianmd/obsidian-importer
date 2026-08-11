import { NodePickedFile, PickedFile } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';
import { EvernoteRun } from '../run';
import { replaceLastOccurrenceInString } from './string-utils';

export interface NotebookStackProps {
	fullpath: string;
	basename: string;
}

// Conservative limit for enex directory name
const MAX_ENEX_DIR_LENGTH = 100;

/**
 * A folder name nothing is using, numbered "(1)", "(2)" if it is.
 *
 * An import bringing a notebook up to date wants the folder the last one made;
 * one making a copy wants its own. There is no shared equivalent - planNote
 * settles a note's name, and nothing settles a folder's - so this is the one
 * piece of Yarle's naming the importer still does for itself.
 */
const freeFolderName = (run: EvernoteRun, basePath: string, name: string): string => {
	if (!run.output.makesCopies()) return name;

	let uniqueName = name;
	let counter = 1;

	while (run.taken(`${basePath}/${uniqueName}`)) {
		uniqueName = `${name} (${counter})`;
		counter++;

		// Safety check to prevent infinite loop
		if (counter > 9999) {
			throw new Error(`Too many duplicate items with name: ${name}`);
		}
	}

	return uniqueName;
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
	return [outputDir, ...getSanitizedNotebookFolderNames(enex.basename)].join('/');
};

export const setPaths = (run: EvernoteRun, enexFileBasename: string, outputDir: string): void => {
	let truncatedBasename = sanitizeFileName(enexFileBasename);

	if (truncatedBasename.length > MAX_ENEX_DIR_LENGTH) {
		truncatedBasename = sanitizeFileName(truncatedBasename.substring(0, MAX_ENEX_DIR_LENGTH));
		console.warn(`ENEX filename too long (${enexFileBasename.length} chars), truncated to ${MAX_ENEX_DIR_LENGTH} chars: ${truncatedBasename}`);
	}

	run.paths.mdPath = `${outputDir}/${freeFolderName(run, outputDir, truncatedBasename)}`;
	run.claim(run.paths.mdPath);
};
