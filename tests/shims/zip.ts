import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from '@zip.js/zip.js';

import { PickedFile } from '../../src/filesystem';

export class SourceZip implements PickedFile {
	readonly type = 'file' as const;
	readonly extension = 'zip';
	readonly basename: string;

	constructor(readonly name: string, private readonly blob: Blob) {
		this.basename = name.replace(/\.zip$/, '');
	}

	get fullpath(): string {
		return this.name;
	}

	async read(): Promise<ArrayBuffer> {
		return await this.blob.arrayBuffer();
	}

	async readText(): Promise<string> {
		throw new Error('not text');
	}

	async *readChunks(): AsyncIterable<string> {
		throw new Error('not text');
	}

	async readZip(callback: (zip: ZipReader<unknown>) => Promise<void>): Promise<void> {
		return await callback(new ZipReader(new BlobReader(this.blob)));
	}

	toString(): string {
		return this.name;
	}
}

export async function zipOf(entries: Record<string, string>, name = 'Export.zip'): Promise<SourceZip> {
	const writer = new ZipWriter(new BlobWriter('application/zip'));
	for (const [path, content] of Object.entries(entries)) {
		await writer.add(path, new TextReader(content));
	}

	return new SourceZip(name, await writer.close());
}
