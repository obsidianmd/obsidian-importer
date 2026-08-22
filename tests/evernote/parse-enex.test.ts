import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, PickedFile, provideNodeModules } from '../../src/filesystem';
import { EnexElement, parseEnex } from '../../src/formats/evernote/parse-enex';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20240101T000000Z">
<note>
<title>Caf&#233; &amp; Bar — naïve “quotes”</title>
<content><![CDATA[<en-note><div>a &lt; b &amp;&amp; c &gt; d</div><div>日本語のテキスト</div></en-note>]]></content>
<created>20240101T000000Z</created>
<tag>café</tag>
<tag>ünïcode</tag>
<resource><data encoding="base64">iVBORw0KGgo=</data><mime>image/png</mime>
<resource-attributes><file-name>naïve.png</file-name></resource-attributes></resource>
</note>
</en-export>
`;

function inPieces(text: string, size: number): PickedFile {
	return {
		async *readChunks(): AsyncIterable<string> {
			const characters = [...text];
			for (let at = 0; at < characters.length; at += size) {
				yield characters.slice(at, at + size).join('');
			}
		},
	} as PickedFile;
}

async function notesFrom(file: PickedFile): Promise<EnexElement[]> {
	const found: EnexElement[] = [];
	await parseEnex(file, {
		wanted: new Set(['note']),
		onElement: (_name, element) => { found.push(element); },
	});

	return found;
}

test('the whole document, read at once, is what the rest is compared with', async () => {
	const [note] = await notesFrom(inPieces(ENEX, ENEX.length));

	assert.deepEqual(note, {
		title: 'Café & Bar — naïve “quotes”',
		content: '<en-note><div>a &lt; b &amp;&amp; c &gt; d</div><div>日本語のテキスト</div></en-note>',
		created: '20240101T000000Z',
		tag: ['café', 'ünïcode'],
		resource: {
			data: { $text: 'iVBORw0KGgo=' },
			mime: 'image/png',
			'resource-attributes': { 'file-name': 'naïve.png' },
		},
	});
});

test('a split at every position in the document reads the same note', async () => {
	const whole = await notesFrom(inPieces(ENEX, ENEX.length));

	for (let size = 1; size <= [...ENEX].length; size++) {
		assert.deepEqual(await notesFrom(inPieces(ENEX, size)), whole, `in pieces of ${size}`);
	}
});

test('a character split across two reads is put back together', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-chunks-'));

	try {
		const text = 'a'.repeat(65_535) + '日本語' + 'b'.repeat(10);
		const at = nodePath.join(dir, 'straddles.txt');
		nodeFs.writeFileSync(at, text, 'utf8');

		const pieces: string[] = [];
		for await (const piece of new NodePickedFile(at).readChunks()) pieces.push(piece);

		assert.ok(pieces.length > 1, 'the file is read in more than one piece');
		assert.equal(pieces.join(''), text);
		assert.ok(!pieces.join('').includes('�'), 'and no character is lost to the boundary');
	}
	finally {
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

test('a read stopped between pieces gives back only what it had reached', async () => {
	const found: EnexElement[] = [];
	let pieces = 0;

	await parseEnex(inPieces(ENEX, 8), {
		wanted: new Set(['note']),
		onElement: (_name, element) => { found.push(element); },
		checkpoint: async () => ++pieces > 3,
	});

	assert.deepEqual(found, [], 'the note is not complete three pieces in');
	assert.equal(pieces, 4, 'and the read stops rather than running to the end');
});
