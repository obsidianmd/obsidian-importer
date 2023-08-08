let illegalRe = /[\/\?<>\\:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;
let potentialTagsRe = /(#[^ ^#]*)/g; // Finds any non-whitespace sections starting with #
let illegalTagCharsRe = /[\\:*?<>\"|!@#$%^&()+=\`\'~;,.]/g;

export function sanitizeFileName(name: string) {
	return name
		.replace(illegalRe, '')
		.replace(controlRe, '')
		.replace(reservedRe, '')
		.replace(windowsReservedRe, '')
		.replace(windowsTrailingRe, '');
}

/**
 * Searches a string for characters unsupported by Obsidian in the tag body and returns a sanitized string.
 * If the # symbol is included at the start or anywhere else it will be removed.
 */
export function sanitizeTag(name: string): string {
	// Remove problem characters
	let tagName = name
		.replace(illegalTagCharsRe, '')
		.replace(reservedRe, '')
		.replace(windowsReservedRe, '');
	// Convert spaces to hyphens	
	tagName = tagName.split(' ').join('-');
	// Prevent tags starting with a number
	if(!isNaN(tagName[0] as any)) {
		tagName = '_' + tagName;
	}
	
	return tagName;
}

/**
 * Searches a string for tags that include characters unsupported in tags by Obsidian.
 * Returns a string with those hastags normalised.
 */
export function sanitizeTags(str: string): string {
	const newStr = str.replace(potentialTagsRe, (str: string) : string => {
		return '#' + sanitizeTag(str);
	});
	return newStr;
}

export function genUid(length: number): string {
	let array: string[] = [];
	for (let i = 0; i < length; i++) {
		array.push((Math.random() * 16 | 0).toString(16));
	}
	return array.join('');
}

/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */
export function toSentenceCase(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Adds a single tag to the tag property in frontmatter and santises it.
 * Must pass in app.fileManager.
 */
export function addTagToFrontmatter(frontmatter: any, tag: string) {
	const sanitizedTag = sanitizeTag(tag);
	if(!frontmatter['tags']) {
		frontmatter['tags'] = [sanitizedTag];
	} else {
		if (!Array.isArray(frontmatter['tags'])) {
			frontmatter['tags'] = frontmatter['tags'].split(' ');
		}
		frontmatter['tags'].push(sanitizedTag);
	}
}

/**
 * Adds an alias to the note's frontmatter.
 * Only linebreak sanitization is performed in this function.
 * Must pass in app.fileManager.
*/
export function addAliasToFrontmatter(frontmatter: any, alias: string) {
	const sanitizedAlias = alias.split('\n').join(', ');
	if(!frontmatter['aliases']) {
		frontmatter['aliases'] = [sanitizedAlias];
	} else {
		if (!Array.isArray(frontmatter['aliases'])) {
			frontmatter['aliases'] = frontmatter['aliases'].split(' ');
		}
		frontmatter['aliases'].push(sanitizedAlias);
	}
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
