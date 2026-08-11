import { PickedFile } from '../../../filesystem';
import { availableFileName, sanitizeFileName } from '../../../util';
import { EvernoteRun } from '../run';
import { replaceLastOccurrenceInString } from './string-utils';

export interface NotebookStackProps {
	fullpath: string;
	basename: string;
}

// Conservative limit for enex directory name
const MAX_ENEX_DIR_LENGTH = 100;

/**
 * A folder name nothing is using, numbered "1", "2" if it is.
 *
 * An import bringing a notebook up to date wants the folder the last one made;
 * one making a copy wants its own. There is no shared equivalent - planNote
 * settles a note's name, and nothing settles a folder's - so this is the one
 * piece of naming the importer still does for itself, and it numbers the way
 * availableFileName does so a folder reads like everything beside it.
 */
const freeFolderName = (run: EvernoteRun, basePath: string, name: string): string => {
	if (!run.output.makesCopies()) return name;

	return availableFileName(name, candidate => run.taken(`${basePath}/${candidate}`));
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
