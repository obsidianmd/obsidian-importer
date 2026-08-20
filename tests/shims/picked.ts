import { PickedFile, PickedFolder } from '../../src/filesystem';

export class SourceFile implements PickedFile {
	readonly type = 'file' as const;
	readonly fullpath: string;
	readonly name: string;
	readonly basename: string;
	readonly extension: string;

	constructor(name: string, private readonly text: string = '') {
		this.fullpath = this.name = name;

		const dot = name.lastIndexOf('.');
		this.basename = dot > 0 ? name.slice(0, dot) : name;
		this.extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
	}

	async readText(): Promise<string> {
		return this.text;
	}

	async read(): Promise<ArrayBuffer> {
		return new TextEncoder().encode(this.text).buffer;
	}

	async *readChunks(): AsyncIterable<string> {
		yield this.text;
	}

	async readZip(): Promise<void> {
		throw new Error('not a zip');
	}

	toString(): string {
		return this.name;
	}
}

export class SourceFolder implements PickedFolder {
	readonly type = 'folder' as const;

	constructor(
		readonly name: string,
		private readonly items: (PickedFile | PickedFolder)[],
		private readonly delay: number = 0,
	) {}

	async list(): Promise<(PickedFile | PickedFolder)[]> {
		for (let tick = 0; tick < this.delay; tick++) await Promise.resolve();

		return this.items;
	}

	toString(): string {
		return this.name;
	}
}
