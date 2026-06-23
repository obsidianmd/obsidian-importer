import { sanitizeFileName } from '../../sanitize';

export function getKeepMarkdownBasePath(folderPath: string, filename: string): string {
	const sanitizedName = sanitizeFileName(filename);
	const parentPath = folderPath === '/' ? '' : normalizeFolderPath(folderPath);

	return parentPath ? `${parentPath}/${sanitizedName}` : sanitizedName;
}

export function getAvailableKeepMarkdownPath(
	fileExists: (path: string) => boolean,
	folderPath: string,
	filename: string,
): string {
	const basePath = getKeepMarkdownBasePath(folderPath, filename);
	let path = `${basePath}.md`;
	let counter = 1;

	while (fileExists(path)) {
		path = `${basePath} ${counter}.md`;
		counter++;
	}

	return path;
}

function normalizeFolderPath(folderPath: string): string {
	return folderPath.split('/').filter(Boolean).join('/');
}
