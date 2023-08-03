function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_CHARACTERS) + ']', 'g');

export function sanitizeFileName(name: string) {
	return name.replace(ILLEGAL_FILENAME_RE, '');
}

export function genUid(length: number): string {
	let array: string[] = [];
	for (let i = 0; i < length; i++) {
		array.push((Math.random() * 16 | 0).toString(16));
	}
	return array.join('');
}

export function pathToFilename(path: string) {
	if (!path.contains('/')) return path;
	const lastSlashPosition = path.lastIndexOf('/');
	return path.slice(lastSlashPosition + 1);
}

export function splitFilename(filename: string) {
	const lastDotPosition = filename.lastIndexOf('.');
	if (lastDotPosition === -1 || lastDotPosition === filename.length - 1 || lastDotPosition === 0) {
		return { basename: filename, extension: "" };
	}
	return { basename: filename.slice(0, lastDotPosition), extension: filename.slice(lastDotPosition + 1) };
}

export class PromiseExecutor {
	readonly pool: PromiseLike<number>[];

	constructor(concurrency: number) {
		this.pool = [...new Array(concurrency)].map((_0, index) => Promise.resolve(index));
	}

	async run<T>(func: () => PromiseLike<T>): Promise<T> {
		const index = await Promise.race(this.pool);
		const ret = func();
		this.pool[index] = ret.then(() => index, () => index);
		return await ret;
	}
}
