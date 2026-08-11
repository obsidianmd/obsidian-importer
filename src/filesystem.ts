import { BlobReader, configure, Reader, ZipReader } from '@zip.js/zip.js';
import { Platform } from 'obsidian';
import { decodeChunks, decodeText } from './encoding';
import { configureWebWorker } from './z-worker-inline';

type NodeFS = typeof import('node:fs');
type Dirent = import('node:fs').Dirent;
type FileHandle = import('node:fs').promises.FileHandle;

configureWebWorker(configure);

export interface PickedFile {
	readonly type: 'file';
	/** Full path, including container zip names, for debugging/reporting purposes */
	readonly fullpath: string;
	/** File name, including extension */
	readonly name: string;
	/** Base file name, without extension */
	readonly basename: string;
	/** Lowercase extension */
	readonly extension: string;

	/** Read the file as text, in whatever encoding it declares. */
	readText(): Promise<string>;

	/** Read that text incrementally, without splitting a character. */
	readChunks(): AsyncIterable<string>;

	/** Read the file as binary */
	read(): Promise<ArrayBuffer>;

	/** Read the file as zip, processing the zip in the callback */
	readZip(callback: (zip: ZipReader<unknown>) => Promise<void>): Promise<void>;

	toString(): string;
}

export interface PickedFolder {
	readonly type: 'folder';
	/** Folder name */
	readonly name: string;
	/** List files in this folder */
	list: () => Promise<(PickedFile | PickedFolder)[]>;

	toString(): string;
}

// Tests replace these bindings to run conversion code outside Obsidian.
// Named nodeCrypto so it does not shadow the global Web Crypto `crypto`.
export let nodeCrypto: typeof import('node:crypto') = Platform.isDesktopApp ? window.require('node:crypto') : null;
export let fs: NodeFS = Platform.isDesktopApp ? window.require('node:original-fs') : null;
export let fsPromises: NodeFS['promises'] = Platform.isDesktopApp ? fs.promises : null!;
export let os: typeof import('node:os') = Platform.isDesktopApp ? window.require('node:os') : null;
export let path: typeof import('node:path') = Platform.isDesktopApp ? window.require('node:path') : null;
export let url: typeof import('node:url') = Platform.isDesktopApp ? window.require('node:url') : null;
export let zlib: typeof import('node:zlib') = Platform.isDesktopApp ? window.require('node:zlib') : null;

export interface NodeModules {
	nodeCrypto?: typeof import('node:crypto');
	fs?: NodeFS;
	os?: typeof import('node:os');
	path?: typeof import('node:path');
	url?: typeof import('node:url');
	zlib?: typeof import('node:zlib');
}

export function provideNodeModules(modules: NodeModules): void {
	if (modules.nodeCrypto) nodeCrypto = modules.nodeCrypto;
	if (modules.fs) {
		fs = modules.fs;
		fsPromises = modules.fs.promises;
	}
	if (modules.os) os = modules.os;
	if (modules.path) path = modules.path;
	if (modules.url) url = modules.url;
	if (modules.zlib) zlib = modules.zlib;
}

// Wide enough to hold any charset declaration the first chunk is read for.
const READ_CHUNK = 1 << 16;

export function nodeBufferToArrayBuffer(buffer: Buffer<ArrayBuffer>, offset = 0, length = buffer.byteLength - offset): ArrayBuffer {
	return buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length);
}

export class NodePickedFile implements PickedFile {
	readonly type = 'file' as const;
	readonly filepath: string;

	readonly fullpath: string;
	readonly name: string;
	readonly basename: string;
	readonly extension: string;

	constructor(filepath: string) {
		this.filepath = filepath;
		let name = this.name = path.basename(filepath);
		// Use only the name here since the parent folder isn't relevant
		this.fullpath = name;
		// Extension with dot
		let extension = path.extname(name);
		// Extension without dot
		this.extension = extension.substring(1).toLowerCase();
		this.basename = path.basename(name, extension);
	}

	async readText(): Promise<string> {
		return decodeText(await fsPromises.readFile(this.filepath));
	}

	async read(): Promise<ArrayBuffer> {
		let buffer = await fsPromises.readFile(this.filepath);
		return nodeBufferToArrayBuffer(buffer);
	}

	async *readChunks(): AsyncIterable<string> {
		const handle = await fsPromises.open(this.filepath, 'r');
		try {
			yield* decodeChunks(async function* () {
				const buffer = Buffer.alloc(READ_CHUNK);

				for (;;) {
					const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
					if (bytesRead === 0) return;

					yield buffer.subarray(0, bytesRead);
				}
			}());
		}
		finally {
			await handle.close();
		}
	}

	async readZip(callback: (zip: ZipReader<unknown>) => Promise<void>): Promise<void> {
		let fd: FileHandle | null = null;
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
	readonly type = 'folder' as const;
	readonly filepath: string;

	readonly name: string;

	constructor(filepath: string) {
		this.filepath = filepath;
		this.name = path.basename(filepath);
	}

	async list(): Promise<(PickedFile | PickedFolder)[]> {
		let { filepath } = this;
		let files: Dirent[] = await fsPromises.readdir(filepath, { withFileTypes: true });
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
	readonly type = 'file' as const;
	readonly file: File;

	readonly fullpath: string;
	readonly name: string;
	readonly basename: string;
	readonly extension: string;

	constructor(file: File) {
		this.file = file;
		let name = this.name = file.name;
		this.fullpath = name;

		let { basename, extension } = parseFilePath(name);

		this.basename = basename;
		this.extension = extension;
	}

	async readText(): Promise<string> {
		// File.text and readAsText decode as UTF-8 before detection can run.
		return decodeText(new Uint8Array(await this.read()));
	}

	async *readChunks(): AsyncIterable<string> {
		const { file } = this;

		yield* decodeChunks(async function* () {
			for (let at = 0; at < file.size; at += READ_CHUNK) {
				yield new Uint8Array(await file.slice(at, at + READ_CHUNK).arrayBuffer());
			}
		}());
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

	async readZip(callback: (zip: ZipReader<unknown>) => Promise<void>): Promise<void> {
		return callback(new ZipReader(new BlobReader(this.file)));
	}

	toString(): string {
		return this.file.name;
	}
}

export async function getAllFiles(files: (PickedFolder | PickedFile)[], filter?: (file: PickedFile) => boolean): Promise<PickedFile[]> {
	let results: PickedFile[] = [];
	for (let file of files) {
		try {
			if (file.type === 'folder') {
				results.push(...await getAllFiles(await file.list(), filter));
			}
			else if (file.type === 'file') {
				if (!filter || filter(file)) {
					results.push(file);
				}
			}
		}
		catch (e) {
			console.error('Skipping path: ', file.name, e);
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

	let [basename, extension] = splitext(name);
	return { parent, name, basename, extension };
}

export function splitext(name: string) {
	let dotIndex = name.lastIndexOf('.');
	let basename = name;
	let extension = '';
	
	if (dotIndex > 0) {
		basename = name.substring(0, dotIndex);
		extension = name.substring(dotIndex + 1).toLowerCase();
	}
	
	return [basename, extension];
}

class FSReader extends Reader<FileHandle> {
	fd: FileHandle;

	constructor(fd: FileHandle, size: number) {
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
