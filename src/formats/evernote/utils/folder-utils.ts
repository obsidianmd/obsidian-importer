import { PickedFile } from '../../../filesystem';
import { sanitizeFileName, sanitizeFilePath } from '../../../util';
import { EvernoteRun } from '../run';
import { replaceLastOccurrenceInString } from './string-utils';

export interface NotebookStackProps {
	fullpath: string;
	basename: string;
}

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

export const getSanitizedNotebookFolderNames = (basename: string, parentPath = ''): string[] => {
	const { notebookFolderNames } = getNotebookNameAndFolderNames(basename);
	const stack = sanitizeFilePath(notebookFolderNames.join('/'), parentPath);

	return stack ? stack.split('/') : [];
};

export const getNotebookStackedProps = (baseEnex: PickedFile): NotebookStackProps => {
	const { notebookName } = getNotebookNameAndFolderNames(baseEnex.basename);

	return {
		fullpath: replaceLastOccurrenceInString(baseEnex.fullpath, baseEnex.basename, notebookName || baseEnex.basename),
		basename: notebookName,
	};

};

export const getNotebookStackOutputDir = (enex: PickedFile, outputDir: string): string => {
	return [outputDir, ...getSanitizedNotebookFolderNames(enex.basename, outputDir)].join('/');
};

export const setPaths = (run: EvernoteRun, enexFileBasename: string, outputDir: string): void => {
	run.mdPath = run.output.planFolder(outputDir, sanitizeFileName(enexFileBasename, outputDir));
};
