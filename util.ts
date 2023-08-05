import { App } from 'obsidian';

let illegalRe = /[\/\?<>\\:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;

export function sanitizeFileName(name: string) {
	return name
		.replace(illegalRe, '')
		.replace(controlRe, '')
		.replace(reservedRe, '')
		.replace(windowsReservedRe, '')
		.replace(windowsTrailingRe, '');
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
}

export function genUid(length: number): string {
	let array: string[] = [];
	for (let i = 0; i < length; i++) {
		array.push(((Math.random() * 16) | 0).toString(16));
	}
	return array.join('');
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
			// skipping any internal links [[ # ]], URLS [ # ]() or []( # ), or already escaped hashtags \#, replace all tag-like things #<word> in the document with \#<word>. Useful for programs (like Notion) that don't support #<word> tags.
			const hashtagInLink = new RegExp(
				`\\[\\[[^\\]]*${hashtag}[^\\]]*\\]\\]|\\[[^\\]]*${hashtag}[^\\]]*\\]\\([^\\)]*\\)|\\[[^\\]]*\\]\\([^\\)]*${hashtag}[^\\)]*\\)|\\\\${hashtag}`
			);

			if (hashtagInLink.test(newLine)) continue;
			newLine = newLine.replace(hashtag, '\\' + hashtag);
		}
		lines[i] = newLine;
	}
	body = lines.join('\n');
	return body;
}

export class PromiseExecutor {
	readonly pool: PromiseLike<number>[];
	revision: object = {};

	constructor(concurrency: number) {
		this.pool = [...new Array(concurrency)].map((_0, index) => Promise.resolve(index));
	}

	async run<T>(func: () => PromiseLike<T>): Promise<T> {
		if (this.pool.length <= 0) {
			return await func();
		}
		let { revision } = this;
		let index = await Promise.race(this.pool);
		while (this.revision !== revision) {
			revision = this.revision;
			index = await Promise.race(this.pool);
		}
		this.revision = {};
		const ret = func();
		this.pool[index] = ret.then(() => index, () => index);
		return await ret;
	}
}

export function parseHTML(html: string): HTMLElement {
	return new DOMParser().parseFromString(html, 'text/html').body;
}

export function uint8arrayToArrayBuffer(input: Uint8Array): ArrayBuffer {
	return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
}

export function stringToUtf8(text: string): ArrayBuffer {
	return uint8arrayToArrayBuffer(new TextEncoder().encode(text));
}