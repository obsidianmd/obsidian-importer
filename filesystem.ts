import { BlobReader, configure, Reader, ZipReader } from '@zip.js/zip.js';
import type * as NodeFS from 'node:fs';
import type * as NodePath from 'node:path';
import type * as NodeUrl from 'node:url';
import { Platform } from 'obsidian';
import { configureWebWorker } from './zip/z-worker-inline';

configureWebWorker(configure);

export interface PickedFile {
	type: 'file';
	/** File name, including extension */
	name: string;
	/** Base file name, without extension */
	basename: string;
	/** Lowercase extension */
	extension: string;

	/** Read the file as utf8 text */
	readText(): Promise<string>;

	/** Read the file as binary */
	read(): Promise<ArrayBuffer>;

	/** Read the file as zip, processing the zip in the callback */
	readZip(callback: (zip: ZipReader<any>) => Promise<void>): Promise<void>;
}

export interface PickedFolder {
	type: 'folder';
	/** Folder name */
	name: string;
	/** List files in this folder */
	list: () => Promise<(PickedFile | PickedFolder)[]>;
}

export const fs: typeof NodeFS = Platform.isDesktopApp ? window.require('node:fs') : null;
export const fsPromises: typeof NodeFS.promises = Platform.isDesktopApp ? fs.promises : null!;
export const path: typeof NodePath = Platform.isDesktopApp ? window.require('node:path') : null;
export const url: typeof NodeUrl = Platform.isDesktopApp ? window.require('node:url') : null;

export function nodeBufferToArrayBuffer(buffer: Buffer, offset = 0, length = buffer.byteLength): ArrayBuffer {
	return buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length);
}

export class NodePickedFile implements PickedFile {
	type: 'file' = 'file';
	filepath: string;

	name: string;
	basename: string;
	extension: string;

	constructor(filepath: string) {
		this.filepath = filepath;
		let name = this.name = path.basename(filepath);
		// Extension with dot
		let extension = path.extname(name);
		// Extension without dot
		this.extension = extension.substring(1).toLowerCase();
		this.basename = path.basename(name, extension);
	}

	async readText(): Promise<string> {
		return fsPromises.readFile(this.filepath, 'utf8');
	}

	async read(): Promise<ArrayBuffer> {
		let buffer = await fsPromises.readFile(this.filepath);
		return nodeBufferToArrayBuffer(buffer);
	}

	async readZip(callback: (zip: ZipReader<any>) => Promise<void>): Promise<void> {
		let fd: NodeFS.promises.FileHandle | null = null;
		try {
			fd = await fsPromises.open(this.filepath, 'r');
			let stat = await fd.stat();
			return await callback(new ZipReader(new FSReader(fd, stat.size)));
		}
		finally {
			await fd?.close();
		}
	}

	createReadStream() {
		return fs.createReadStream(this.filepath);
	}

	toString(): string {
		return this.filepath;
	}
}

export class NodePickedFolder implements PickedFolder {
	type: 'folder' = 'folder';
	filepath: string;

	name: string;

	constructor(filepath: string) {
		this.filepath = filepath;
		this.name = path.basename(filepath);
	}

	async list(): Promise<(PickedFile | PickedFolder)[]> {
		let { filepath } = this;
		let files: NodeFS.Dirent[] = await fsPromises.readdir(filepath, { withFileTypes: true });
		let results = [];

		for (let file of files) {
			if (file.isFile()) {
				results.push(new NodePickedFile(path.join(filepath, file.name)));
			}
			else if (file.isDirectory()) {
				results.push(new NodePickedFolder(path.join(filepath, file.name)));
			}
		}

		return results;
	}

	toString(): string {
		return this.filepath;
	}
}

export class WebPickedFile implements PickedFile {
	type: 'file' = 'file';
	file: File;

	name: string;
	basename: string;
	extension: string;

	constructor(file: File) {
		this.file = file;
		let name = this.name = file.name;

		let { basename, extension } = parseFilePath(name);

		this.basename = basename;
		this.extension = extension;
	}

	readText(): Promise<string> {
		let { file } = this;
		if (file.text) {
			return file.text();
		}
		return new Promise((resolve, reject) => {
			let reader = new FileReader();
			reader.addEventListener('load', () => resolve(reader.result as string));
			reader.addEventListener('error', reject);
			reader.readAsText(this.file);
		});
	}

	async read(): Promise<ArrayBuffer> {
		let { file } = this;
		if (file.arrayBuffer) {
			return file.arrayBuffer();
		}
		return new Promise((resolve, reject) => {
			let reader = new FileReader();
			reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer));
			reader.addEventListener('error', reject);
			reader.readAsArrayBuffer(this.file);
		});
	}

	async readZip(callback: (zip: ZipReader<any>) => Promise<void>): Promise<void> {
		return callback(new ZipReader(new BlobReader(this.file)));
	}

	toString(): string {
		return this.file.toString();
	}
}

export async function getAllFiles(files: (PickedFolder | PickedFile)[], filter?: (file: PickedFile) => boolean): Promise<PickedFile[]> {
	let results: PickedFile[] = [];
	for (let file of files) {
		if (file.type === 'folder') {
			results.push(...await getAllFiles(await file.list(), filter));
		}
		else if (file.type === 'file') {
			if (!filter || filter(file)) {
				results.push(file);
			}
		}
	}
	return results;
}

/**
 * Parse a filepath to get a file's parent path, name, basename (name without extension), and extension (lowercase).
 * For example, "path/to/my/file.md" would become `{parent: "path/to/my", name: "file.md", basename: "file", extension: "md"}`
 */
export function parseFilePath(filepath: string): { parent: string, name: string, basename: string, extension: string } {
	let lastIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
	let name = filepath;
	let parent = '';
	if (lastIndex >= 0) {
		name = filepath.substring(lastIndex + 1);
		parent = filepath.substring(0, lastIndex);
	}

	let dotIndex = name.lastIndexOf('.');
	let basename = name;
	let extension = '';
	if (dotIndex > 0) {
		basename = name.substring(0, dotIndex);
		extension = name.substring(dotIndex + 1).toLowerCase();
	}

	return { parent, name, basename, extension };
}

class FSReader extends Reader<NodeFS.promises.FileHandle> {
	fd: NodeFS.promises.FileHandle;

	constructor(fd: NodeFS.promises.FileHandle, size: number) {
		super(fd);
		this.fd = fd;
		this.size = size;
	}

	async readUint8Array(offset: number, length: number) {
		let buffer = Buffer.alloc(length);
		let result = await this.fd.read(buffer, 0, length, offset);
		return new Uint8Array(nodeBufferToArrayBuffer(buffer, 0, result.bytesRead));
	}
}
