import { PickedFile } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';
import { EvernoteRun } from '../run';
import { replaceLastOccurrenceInString } from './string-utils';

export interface NotebookStackProps {
	fullpath: string;
	basename: string;
}

// Conservative limit for enex directory name
const MAX_ENEX_DIR_LENGTH = 100;

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
	// Against the folder it is going in, so the notebook's name is budgeted for
	// the whole path the way planNote budgets a note's. The 100 characters on
	// top of that are Evernote's own: every note in the notebook has to fit
	// inside this name as well, and the shared limit only knows about the name
	// it is given.
	let truncatedBasename = sanitizeFileName(enexFileBasename, outputDir);

	if (truncatedBasename.length > MAX_ENEX_DIR_LENGTH) {
		truncatedBasename = sanitizeFileName(truncatedBasename.substring(0, MAX_ENEX_DIR_LENGTH), outputDir);
		console.warn(`ENEX filename too long (${enexFileBasename.length} chars), truncated to ${MAX_ENEX_DIR_LENGTH} chars: ${truncatedBasename}`);
	}

	run.mdPath = run.output.planFolder(outputDir, truncatedBasename);
};
