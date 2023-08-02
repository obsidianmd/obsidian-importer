import { App } from 'obsidian';

export function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>"|';
const ILLEGAL_FILENAME_RE = new RegExp(
	'[' + escapeRegex(ILLEGAL_CHARACTERS) + ']',
	'g'
);

export function sanitizeFileName(name: string) {
	return name.replace(ILLEGAL_FILENAME_RE, '');
}

export function matchFilename(path: string) {
	return path.match(/([^\/\.]*)(\.[^\/]+)?$/)?.[1];
}

export function pathToFilename(path: string) {
	if (!path.contains('/')) return path;

	let lastSlashPosition = path.lastIndexOf('/');
	let filename = path.slice(lastSlashPosition + 1);
	let lastDotPosition = filename.lastIndexOf('.');

	if (
		lastDotPosition === -1 ||
		lastDotPosition === filename.length - 1 ||
		lastDotPosition === 0
	) {
		return filename;
	}

	return filename.slice(0, lastDotPosition);
}

export function getFileExtension(path: string) {
	return path.contains('.') && path.lastIndexOf('.') !== 0
		? path.slice(path.lastIndexOf('.') + 1)
		: '';
}

export function getParentFolder(path: string) {
	return path.contains('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

export function escapeHashtags(body: string) {
	const tagExp = /#[a-z0-9\-]+/gi;

	if (!tagExp.test(body)) return body;
	const lines = body.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const hashtags = lines[i].match(tagExp);
		if (!hashtags) continue;
		let newLine = lines[i];
		for (let hashtag of hashtags) {
			const hashtagInLink = new RegExp(
				`\\[\\[[^\\]]*${hashtag}[^\\]]*\\]\\]|\\[[^\\]]*${hashtag}[^\\]]*\\]\\([^\\)]*\\)|\\[[^\\]]*\\]\\([^\\)]*${hashtag}[^\\)]*\\)|\\\\${hashtag}`
			);

			if (hashtagInLink.test(newLine)) continue;
			newLine = newLine.replace(hashtag, '\\' + hashtag);
		}
		lines[i] = newLine;
	}
	return lines.join('\n');
}

export function fixDuplicateSlashes(path: string) {
	return path.replace(/\/\/+/g, '/');
}

export async function createFolderStructure(paths: Set<string>, app: App) {
	const createdFolders = new Set<string>();

	for (let path of paths) {
		const nestedFolders = path.split('/').filter((path) => path);
		let createdFolder = '';
		for (let folder of nestedFolders) {
			createdFolder += folder + '/';
			if (!createdFolders.has(createdFolder)) {
				createdFolders.add(createdFolder);
				// Apparently Obsidian serializes everything so doing it in parallel doesn't make a difference.
				await app.vault.createFolder(createdFolder).catch(() => {
					console.warn(`Skipping created folder: ${createdFolder}`);
				});
			}
		}
	}
}
