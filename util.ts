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
