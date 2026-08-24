import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js';

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

export async function zipOf(entries: Record<string, string | ArrayBuffer | Uint8Array>, name = 'Export.zip'): Promise<SourceZip> {
	const writer = new ZipWriter(new BlobWriter('application/zip'));
	for (const [path, content] of Object.entries(entries)) {
		const reader = typeof content === 'string'
			? new TextReader(content)
			: new Uint8ArrayReader(content instanceof Uint8Array ? content : new Uint8Array(content));
		await writer.add(path, reader);
	}

	return new SourceZip(name, await writer.close());
}
