import { fs, path } from '../../../filesystem';

export const getAllOutputFilesWithExtension = (dirPath: string, arrayOfFiles: string[], extension: string): string[] => {
	const files = fs.readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];
	files.forEach(file => {
		if (fs.statSync(`${dirPath}/${file}`).isDirectory()) {
			arrayOfFiles = getAllOutputFilesWithExtension(`${dirPath}/${file}`, arrayOfFiles, extension);
		}
		else {
			if ((extension && path.extname(file) == `.${extension}`) || !extension) {
				arrayOfFiles.push(path.join(dirPath, '/', file));
			}
		}
	});

	return arrayOfFiles;
};
