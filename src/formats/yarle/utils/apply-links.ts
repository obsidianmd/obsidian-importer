import { fs, path } from '../../../filesystem';

import { YarleOptions } from '../options';
import { RuntimePropertiesSingleton } from '../runtime-properties';
import { escapeStringRegexp } from './escape-string-regexp';
import { truncatFileName } from './folder-utils';
import { getAllOutputFilesWithExtension } from './get-all-output-files';

export const applyLinks = (options: YarleOptions, outputNotebookFolders: Array<string>): void => {
	const linkNameMap = RuntimePropertiesSingleton.getInstance();
	const allLinks = linkNameMap.getAllNoteIdNameMap();

	let entries = Object.entries(allLinks);
	if (entries.length === 0) return;

	console.log('About to update links...');

	const allconvertedFiles: Array<string> = [];
	for (const outputFolder of outputNotebookFolders) {
		getAllOutputFilesWithExtension(outputFolder, allconvertedFiles, '');
	}

	for (const notebookFolder of outputNotebookFolders) {
		console.log(`Notebook: ${notebookFolder}`);
		const filesInOutputDir = fs.readdirSync(notebookFolder);

		const targetFiles = filesInOutputDir.filter(file => {
			return path.extname(file).toLowerCase() === '.md';
		});
		console.log(`${targetFiles.length} files to check for links`);

		for (const targetFile of targetFiles) {
			let filepath = path.join(notebookFolder, targetFile);
			const fileContent = fs.readFileSync(filepath, 'utf8');
			let updatedContent = fileContent;

			for (const [linkName, linkProps] of entries) {
				const uniqueId = linkProps.uniqueEnd;
				let fileName = linkProps.title;
				if (allconvertedFiles.find(fn => fn.includes(uniqueId))) {
					fileName = truncatFileName(fileName, uniqueId);
				}

				const notebookName = linkProps.notebookName;
				const encodedFileName = options.urlEncodeFileNamesAndLinks ? encodeURI(fileName as string) : fileName as string;

				let replacement = encodedFileName;
				if (notebookName && !notebookFolder.endsWith(notebookName)) {
					replacement = `${notebookName}/${encodedFileName}`;
				}

				const regexp = new RegExp(escapeStringRegexp(linkName), 'g');
				updatedContent = updatedContent.replace(regexp, replacement);
			}

			if (fileContent !== updatedContent) {
				console.log(`File written: ${filepath}`);
				fs.writeFileSync(filepath, updatedContent);
			}
		}
	}

	console.log('Link update complete.');
};

