import { BlobReader, BlobWriter, Entry, TextWriter, ZipReader } from '@zip.js/zip.js';
import { parseFilePath, PickedFile } from './filesystem';

interface FileEntry extends Entry {
	directory: false;
	getData: NonNullable<Entry['getData']>;
}

export class ZipEntryFile implements PickedFile {
	type: 'file' = 'file';
	entry: FileEntry;
	fullpath: string;
	parent: string;
	name: string;
	basename: string;
	extension: string;

	constructor(zip: PickedFile, entry: FileEntry) {
		this.entry = entry;
		this.fullpath = zip.fullpath + '/' + entry.filename;
		let { parent, name, basename, extension } = parseFilePath(entry.filename);
		this.parent = parent;
		this.name = name;
		this.basename = basename;
		this.extension = extension;
	}

	async readText(): Promise<string> {
		return this.entry.getData(new TextWriter());
	}

	async read(): Promise<ArrayBuffer> {
		return (await this.entry.getData(new BlobWriter())).arrayBuffer();
	}

	get filepath() {
		return this.entry.filename;
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

	async readZip(callback: (zip: ZipReader<any>) => Promise<void>): Promise<void> {
		return callback(new ZipReader(new BlobReader(new Blob([await this.read()]))));
	}
}

export async function readZip(file: PickedFile, callback: (zip: ZipReader<any>, entries: ZipEntryFile[]) => Promise<void>) {
	await file.readZip(async zip => {
		let entries = await zip.getEntries();
		let files = entries
			.filter((entry): entry is FileEntry => !entry.directory && !!entry.getData)
			.map(entry => new ZipEntryFile(file, entry));

		return callback(zip, files);
	});
}
