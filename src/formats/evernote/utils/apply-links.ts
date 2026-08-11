import { fs, path } from '../../../filesystem';

import { EvernoteOptions, noteWasWrittenBy } from '../options';
import { RuntimePropertiesSingleton } from '../runtime-properties';
import { rewriteFile } from './file-utils';
import { escapeStringRegexp } from './escape-string-regexp';
import { truncatFileName } from './folder-utils';
import { getAllOutputFilesWithExtension } from './get-all-output-files';

export const applyLinks = (options: EvernoteOptions, outputNotebookFolders: Array<string>): void => {
	const linkNameMap = RuntimePropertiesSingleton.getInstance();
	const allLinks = linkNameMap.getAllNoteIdNameMap();

	let entries = Object.entries(allLinks);
	if (entries.length === 0) return;


	const allconvertedFiles: Array<string> = [];
	for (const outputFolder of outputNotebookFolders) {
		getAllOutputFilesWithExtension(outputFolder, allconvertedFiles, '');
	}

	for (const notebookFolder of outputNotebookFolders) {
		const filesInOutputDir = fs.readdirSync(notebookFolder);

		const targetFiles = filesInOutputDir.filter(file => {
			return path.extname(file).toLowerCase() === '.md';
		});

		for (const targetFile of targetFiles) {
			let filepath = path.join(notebookFolder, targetFile);
			if (!noteWasWrittenBy(filepath)) continue;

			const fileContent = fs.readFileSync(filepath, 'utf8');
			let updatedContent = fileContent;

			for (const [linkName, linkProps] of entries) {
				const uniqueId = linkProps.uniqueEnd;
				let fileName = linkProps.title;
				if (allconvertedFiles.find(fn => fn.includes(uniqueId))) {
					fileName = truncatFileName(fileName, uniqueId);
				}

				const notebookName = linkProps.notebookName;

				let replacement = fileName;
				if (notebookName && !notebookFolder.endsWith(notebookName)) {
					replacement = `${notebookName}/${fileName}`;
				}

				const regexp = new RegExp(escapeStringRegexp(linkName), 'g');
				updatedContent = updatedContent.replace(regexp, replacement);
			}

			if (fileContent !== updatedContent) {
				rewriteFile(filepath, updatedContent);
			}
		}
	}

};
