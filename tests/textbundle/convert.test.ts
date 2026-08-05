/**
 * The textbundle conversion, outside Obsidian.
 *
 * A textbundle is a folder holding one markdown file, an info.json saying what
 * that markdown is, and the assets it refers to. It arrives as a folder, as a
 * .textpack (one bundle zipped), or as a zip of several - all three are here,
 * and each bundle is recorded as the note a user would get.
 *
 * Where the assets themselves land is the importer's, so the note is converted
 * against the folder it uses by default.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';

import {
	bundleNoteName,
	convertTextbundleNote,
	groupFilesByTextbundle,
	isMarkdownBundle,
} from '../../src/formats/textbundle/convert';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

/** Where the importer puts a bundle's assets. */
const ASSETS_FOLDER = 'Textbundle/assets';

interface Entry {
	fullpath: string;
	name: string;
	parent: string;
	text?: string;
}

/**
 * @param archiveName The zip is a folder as far as the importer is concerned,
 *                    and every path inside it hangs off that name.
 */
async function readArchive(bytes: Uint8Array, archiveName: string): Promise<Entry[]> {
	const reader = new ZipReader(new BlobReader(new Blob([bytes as unknown as BlobPart])));
	const entries: Entry[] = [];

	for (const entry of await reader.getEntries()) {
		if (entry.directory || !entry.getData) continue;

		const name = entry.filename.split('/').pop() ?? entry.filename;
		const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
		const textual = extension === 'md' || extension === 'markdown' || extension === 'json';

		entries.push({
			fullpath: `${archiveName}/${entry.filename}`,
			name,
			parent: entry.filename.split('/').slice(0, -1).join('/'),
			text: textual ? await entry.getData(new TextWriter()) : undefined,
		});
	}

	await reader.close();
	return entries;
}

/** A bundle on disk, read the way the importer lists the folder. */
function readBundleFolder(dir: string): Entry[] {
	return nodeFs.readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter(name => nodeFs.statSync(nodePath.join(dir, name)).isFile())
		.map(name => {
			const extension = nodePath.extname(name).slice(1).toLowerCase();
			const textual = extension === 'md' || extension === 'markdown' || extension === 'json';
			return {
				fullpath: `${nodePath.basename(dir)}/${name}`,
				name: nodePath.basename(name),
				parent: nodePath.basename(dir),
				text: textual ? nodeFs.readFileSync(nodePath.join(dir, name), 'utf8') : undefined,
			};
		});
}

/** One bundle's note, or null when the bundle holds something else. */
function convertBundle(entries: Entry[], bundleName: string): { name: string, content: string } | null {
	const info = entries.find(entry => entry.name === 'info.json');
	if (info?.text && !isMarkdownBundle(info.text)) return null;

	const note = entries.find(entry => /\.(md|markdown)$/i.test(entry.name));
	if (!note) return null;

	return {
		name: bundleNoteName(note.parent || bundleName),
		content: convertTextbundleNote(note.text ?? '', ASSETS_FOLDER),
	};
}

function write(root: string, name: string, content: string): void {
	const file = nodePath.join(root, `${name}.md`);
	nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
	nodeFs.writeFileSync(file, content);
}

const archives = [...fixtures(FIXTURES, '.textpack'), ...fixtures(FIXTURES, '.zip')];
const folders = fixtures(FIXTURES, '.textbundle');

test('there are bundles to convert', () => {
	assert.ok(archives.length + folders.length > 0, 'expected bundles in tests/textbundle');
});

for (const folder of folders) {
	test(`converts ${folder.name}`, () => {
		const converted = convertBundle(readBundleFolder(folder.path), folder.name);
		assert.ok(converted, 'the bundle should hold a note');

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-textbundle-'));
		try {
			write(produced, converted.name, converted.content);
			expectTree(produced, expectedFor(folder, nodePath.basename(folder.name, '.textbundle')), folder.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}

for (const archive of archives) {
	test(`converts ${archive.name}`, async () => {
		const entries = await readArchive(nodeFs.readFileSync(archive.path), archive.name);
		const extension = nodePath.extname(archive.name);

		// A .textpack is one bundle; a zip can hold several, grouped by the
		// folder each belongs to
		const bundles = extension === '.textpack'
			? [entries]
			: groupFilesByTextbundle(archive.name, entries);

		assert.ok(bundles.length > 0, 'the archive should hold a bundle');

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-textbundle-'));
		try {
			let written = 0;
			for (const bundle of bundles) {
				const converted = convertBundle(bundle, archive.name);
				if (!converted) continue;

				write(produced, converted.name, converted.content);
				written++;
			}

			assert.ok(written > 0, 'the archive should have produced notes');
			expectTree(produced, expectedFor(archive, nodePath.basename(archive.name, extension)), archive.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}

test('skips a bundle whose markdown is something else', () => {
	assert.equal(isMarkdownBundle('{"type":"public.plain-text"}'), false);
	assert.equal(isMarkdownBundle('{"type":"net.daringfireball.markdown"}'), true);
	// The type is optional, and a bundle without one is taken as markdown
	assert.equal(isMarkdownBundle('{"version":2}'), true);
});

test('leaves a link that is not into the assets folder alone', () => {
	assert.equal(
		convertTextbundleNote('![](https://example.com/a.png)', ASSETS_FOLDER),
		'![](https://example.com/a.png)');
});
