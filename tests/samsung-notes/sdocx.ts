import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

/** Every file in an .sdocx, by its path in the archive. */
export async function readFiles(path: string): Promise<Map<string, ArrayBuffer>> {
	const zip = new ZipReader(new BlobReader(new Blob([nodeFs.readFileSync(path)])));
	const files = new Map<string, ArrayBuffer>();
	for (const entry of await zip.getEntries()) {
		if (entry.directory || !entry.getData) continue;
		const bytes = await entry.getData(new Uint8ArrayWriter());
		files.set(entry.filename, bytes.slice().buffer);
	}
	await zip.close();
	return files;
}

/** note.note with the first bytes of its body object overwritten, so the body can't be read. */
export async function noteWithBrokenBody(): Promise<ArrayBuffer> {
	const note = (await readFiles(nodePath.join(__dirname, '01-basic-formatting.sdocx'))).get('note.note')!;
	const view = new DataView(note);
	let at = 14 + 4;
	at += 2 + view.getUint16(at, true) * 2;
	at += 4 + 8 + 8 + 20;
	at += 4 + view.getUint32(at, true);
	view.setUint32(at + 4, 0, true);
	return note;
}
