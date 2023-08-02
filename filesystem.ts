import type * as NodeFS from 'node:fs';
import type * as NodePath from 'node:path';
import { Platform } from 'obsidian';

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
}

export interface PickedFolder {
	type: 'folder';
	/** Folder name */
	name: string;
	/** List files in this folder */
	list: () => Promise<(PickedFile | PickedFolder)[]>;
}


export const fs: typeof NodeFS = Platform.isDesktopApp ? window.require('node:fs') : null;
export const fsPromises: typeof NodeFS.promises = Platform.isDesktopApp ? fs.promises : null;
export const path: typeof NodePath = Platform.isDesktopApp ? window.require('node:path') : null;

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
		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
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

		let dotIndex = name.lastIndexOf('.');
		if (dotIndex <= 0) {
			this.basename = name;
			this.extension = '';
		}
		else {
			this.basename = name.substring(0, dotIndex);
			this.extension = name.substring(dotIndex + 1).toLowerCase();
		}
	}

	readText(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let reader = new FileReader();
			reader.addEventListener('load', () => resolve(reader.result as string));
			reader.addEventListener('error', reject);
			reader.readAsText(this.file);
		});
	}

	async read(): Promise<ArrayBuffer> {
		return this.file.arrayBuffer();
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
