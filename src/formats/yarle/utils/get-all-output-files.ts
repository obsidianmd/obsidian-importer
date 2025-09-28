import { fs, path } from '../../../filesystem';

export const getAllOutputFilesWithExtension = (dirPath: string, arrayOfFiles: string[], extension: string): string[] => {
	const files = fs.readdirSync(dirPath, { withFileTypes: true });

	files.forEach(file => {
		if (file.isDirectory()) {
			getAllOutputFilesWithExtension(`${dirPath}${path.sep}${file.name}`, arrayOfFiles, extension);
		}
		else if (!extension || path.extname(file.name) == `.${extension}`) {
			arrayOfFiles.push(path.join(dirPath, '/', file.name));
		}
	});

	return arrayOfFiles;
};
