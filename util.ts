import moment from "moment";

function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_CHARACTERS_NO_DIR = '\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_CHARACTERS) + ']', 'g');
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

export function sanitizeFileNameKeepPath(name: string) {
	if (name.startsWith(".")) {
        return name.slice(1); // Remove the first character (the period)
    }
	return name.replace(ILLEGAL_CHARACTERS_NO_DIR, '');
}

export function genUid(length: number): string {
	let array: string[] = [];
	for (let i = 0; i < length; i++) {
		array.push((Math.random() * 16 | 0).toString(16));
	}
	return array.join('');
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
export function getUserDNPFormat(){
	// @ts-expect-error : Internal Method
	const dailyNotePluginInstance = app.internalPlugins.getPluginById("daily-notes").instance;
	if (!dailyNotePluginInstance) throw new Error("Daily note plugin is not enabled");
	let dailyPageFormat = dailyNotePluginInstance.options.format;
	if (!dailyPageFormat) {
		dailyPageFormat = "YYYY-MM-DD"; // Default format
	}
	return dailyPageFormat;
}

export function convertDateString(dateString: string, newFormat: string): string | null {
	const validFormat = 'MMMM Do, YYYY';
	const dateObj = moment(dateString, validFormat);
  
	if (dateObj.format(validFormat) !== dateString) {
	  // The input date string does not match the specified format
	  return dateString;
	}
  
	if (dateObj.isValid()) {
	  return dateObj.format(newFormat);
	} else {
	  // Handle the case where the input string is not a valid date
	  return dateString;
	}
  }