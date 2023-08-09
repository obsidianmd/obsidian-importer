import { BlobWriter, Entry, TextWriter, ZipReader } from '@zip.js/zip.js';
import { parseFilePath } from '../filesystem';

interface FileEntry extends Entry {
	directory: false;
	getData: NonNullable<Entry['getData']>;
}

export class ZipEntryFile {
	entry: FileEntry;
	parent: string;
	name: string;
	basename: string;
	extension: string;

	constructor(entry: FileEntry) {
		this.entry = entry;
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
}

export async function readZipFiles(zip: ZipReader<any>) {
	let entries = await zip.getEntries();
	return entries.filter((entry): entry is FileEntry => !entry.directory && !!entry.getData).map(entry => new ZipEntryFile(entry));
}
