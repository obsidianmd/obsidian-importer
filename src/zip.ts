import { BlobReader, BlobWriter, Entry, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { decodeText } from './encoding';
import { parseFilePath, PickedFile, PickedFolder, pickedTree } from './filesystem';

interface FileEntry extends Entry {
	directory: false;
	getData: NonNullable<Entry['getData']>;
}

export class ZipEntryFile implements PickedFile {
	type = 'file' as const;
	entry: FileEntry;
	fullpath: string;
	parent: string;
	name: string;
	basename: string;
	extension: string;
	private sourcePath: string;

	constructor(zip: PickedFile, entry: FileEntry) {
		this.entry = entry;
		this.fullpath = zip.fullpath + '/' + entry.filename;
		this.sourcePath = entry.filename;
		let { parent, name, basename, extension } = parseFilePath(entry.filename);
		this.parent = parent;
		this.name = name;
		this.basename = basename;
		this.extension = extension;
	}

	async readText(): Promise<string> {
		// TextWriter decodes as UTF-8 before detection can run.
		return decodeText(await this.entry.getData(new Uint8ArrayWriter()));
	}

	async read(): Promise<ArrayBuffer> {
		return (await this.entry.getData(new BlobWriter())).arrayBuffer();
	}

	async *readChunks(): AsyncIterable<string> {
		yield await this.readText();
	}

	get filepath() {
		return this.sourcePath;
	}

	/** Use a logical source path while retaining fullpath for diagnostics. */
	setFilepath(filepath: string): void {
		this.sourcePath = filepath;
		const parsed = parseFilePath(filepath);
		this.parent = parsed.parent;
		this.name = parsed.name;
		this.basename = parsed.basename;
		this.extension = parsed.extension;
	}

	get size() {
		return this.entry.uncompressedSize;
	}

	get ctime() {
		return this.entry.creationDate;
	}

	get mtime() {
		return this.entry.lastModDate;
	}

	async readZip(callback: (zip: ZipReader<unknown>) => Promise<void>): Promise<void> {
		return callback(new ZipReader(new BlobReader(new Blob([await this.read()]))));
	}
}

export async function readZip(file: PickedFile, callback: (zip: ZipReader<unknown>, entries: ZipEntryFile[]) => Promise<void>) {
	await file.readZip(async zip => {
		let entries = await zip.getEntries();
		let files = entries
			.filter((entry): entry is FileEntry => !entry.directory && !!entry.getData)
			.map(entry => new ZipEntryFile(file, entry));

		return callback(zip, files);
	});
}

/** macOS metadata and other hidden paths. */
const HIDDEN = /(?:^|\/)(?:__MACOSX\/|\.)/;

/** Build the source tree while the archive backing its entries remains open. */
export function zipContents(entries: ZipEntryFile[]): (PickedFile | PickedFolder)[] {
	return pickedTree(entries
		.filter(entry => !HIDDEN.test(entry.filepath))
		.map(entry => ({ path: entry.filepath, file: entry })));
}

export async function withZipContents(
	items: (PickedFile | PickedFolder)[],
	body: (items: (PickedFile | PickedFolder)[]) => Promise<void>,
	report?: (name: string, error: unknown) => void,
): Promise<void> {
	const open = async (index: number, taken: (PickedFile | PickedFolder)[]): Promise<void> => {
		if (index === items.length) return await body(taken);

		const item = items[index];
		if (item.type !== 'file' || item.extension !== 'zip') {
			return await open(index + 1, [...taken, item]);
		}

		let read = false;
		try {
			await readZip(item, async (_zip, entries) => {
				read = true;
				await open(index + 1, [...taken, ...zipContents(entries)]);
			});
		}
		catch (error) {
			if (read || !report) throw error;

			report(item.name, error);
			await open(index + 1, taken);
		}
	};

	await open(0, []);
}
