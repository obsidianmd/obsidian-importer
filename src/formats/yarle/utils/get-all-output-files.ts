import { fs, path } from '../../../filesystem';

export const getAllOutputFilesWithExtension = (dirPath: string, arrayOfFiles: string[], extension: string): string[] => {
	const files = fs.readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];
	files.forEach(file => {
		if (fs.statSync(`${dirPath}${path.sep}${file}`).isDirectory()) {
			arrayOfFiles = getAllOutputFilesWithExtension(`${dirPath}${path.sep}${file}`, arrayOfFiles, extension);
		}
		else {
			if ((extension && path.extname(file) == `.${extension}`) || !extension) {
				arrayOfFiles.push(path.join(dirPath, '/', file));
			}
		}
	});

	return arrayOfFiles;
};
