/**
 * The Bear conversion, outside Obsidian.
 *
 * A .bear2bk backup is a zip of textbundles: markdown, an info.json of Bear's
 * own metadata, and the note's assets. The markdown is already markdown, so
 * what is converted is what surrounds it - a heading repeating the file name,
 * Bear's tag forms, and links into the bundle's assets folder.
 *
 * Where an asset lands is the importer's, so the resolver here names it the way
 * the vault's default attachment setting would. The frontmatter the importer
 * writes from info.json is recorded alongside each note, since which folder a
 * note lands in - archive or trash - is decided from the same metadata.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import type { FrontMatterCache } from 'obsidian';

import { provideNodeModules } from '../../src/filesystem';
import { convertBearNote } from '../../src/formats/bear/convert';
import { serializeFrontMatter } from '../../src/util';
import { expectedFor, expectTree, fixtures } from '../helpers';

// The conversion joins a note's folder with the asset path it references
provideNodeModules({ path: nodePath });

const FIXTURES = __dirname;

interface BackupEntry {
	filepath: string;
	name: string;
	parent: string;
	text?: string;
}

/** Every file in a backup, following the zip Bear nests inside the one it writes. */
async function readBackup(bytes: Uint8Array): Promise<BackupEntry[]> {
	const reader = new ZipReader(new BlobReader(new Blob([bytes as unknown as BlobPart])));
	const entries: BackupEntry[] = [];

	for (const entry of await reader.getEntries()) {
		if (entry.directory || !entry.getData) continue;

		const name = entry.filename.split('/').pop() ?? entry.filename;
		const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';

		if (extension === 'zip' || extension === 'bear2bk') {
			entries.push(...await readBackup(await entry.getData(new Uint8ArrayWriter())));
			continue;
		}

		const textual = extension === 'md' || extension === 'markdown' || extension === 'json';
		entries.push({
			filepath: entry.filename,
			name,
			parent: entry.filename.split('/').slice(0, -1).join('/'),
			text: textual ? await entry.getData(new TextWriter()) : undefined,
		});
	}

	await reader.close();
	return entries;
}

/** What Bear records about a note, as the importer reads it out of info.json. */
function metadataFor(entries: BackupEntry[], parent: string): FrontMatterCache {
	const info = entries.find(entry => entry.parent === parent && entry.name === 'info.json');
	if (!info?.text) return {};

	const bear = JSON.parse(info.text)['net.shinyfrog.bear'] ?? {};
	const frontMatter: FrontMatterCache = {};

	// The importer writes the id only when asked to, and these two only when set
	if (bear.archived === 1 && bear.archivedDate) {
		frontMatter.archived = new Date(Date.parse(bear.archivedDate)).toISOString().slice(0, 19);
	}
	if (bear.trashed === 1 && bear.trashedDate) {
		frontMatter.trashed = new Date(Date.parse(bear.trashedDate)).toISOString().slice(0, 19);
	}

	return frontMatter;
}

const backups = fixtures(FIXTURES, '.bear2bk');

test('there are backups to convert', () => {
	assert.ok(backups.length > 0, 'expected at least one .bear2bk in tests/bear');
});

for (const backup of backups) {
	test(`converts ${backup.name}`, async () => {
		const entries = await readBackup(nodeFs.readFileSync(backup.path));
		const notes = entries.filter(entry => /\.(md|markdown)$/i.test(entry.name));

		assert.ok(notes.length > 0, 'the backup should contain notes');

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-bear-'));
		// One asset can be referenced from more than one note, and the vault
		// hands back the same path for it every time
		const assetPaths = new Map<string, string>();

		try {
			for (const note of notes) {
				// The note is named after its bundle, without the extension
				const basename = nodePath.basename(note.parent, nodePath.extname(note.parent));

				const { content, tags } = await convertBearNote(note.text ?? '', {
					basename,
					parent: note.parent,
					flattenTags: false,
					resolveAsset: async assetPath => {
						const name = nodePath.basename(assetPath);
						if (!assetPaths.has(assetPath)) {
							// Same name, different note: the vault numbers the second
							const taken = [...assetPaths.values()];
							const { name: stem, ext } = nodePath.parse(name);
							let candidate = `Bear/${name}`;
							for (let i = 1; taken.includes(candidate); i++) candidate = `Bear/${stem} ${i}${ext}`;
							assetPaths.set(assetPath, candidate);
						}
						return assetPaths.get(assetPath)!;
					},
				});

				const frontMatter = metadataFor(entries, note.parent);
				if (tags.length > 0) frontMatter.tags = tags;

				// processFrontMatter writes these onto the note the importer has
				// already saved, so the file ends up as one then the other
				const file = nodePath.join(produced, `${basename}.md`);
				nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
				nodeFs.writeFileSync(file, serializeFrontMatter(frontMatter) + content);
			}

			expectTree(produced, expectedFor(backup, nodePath.basename(backup.name, '.bear2bk')), backup.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}

test('splits a nested tag when asked to', async () => {
	const options = {
		basename: 'note',
		parent: 'note.textbundle',
		resolveAsset: async () => assert.fail('no assets here'),
	};

	const nested = await convertBearNote('#parent/child', { ...options, flattenTags: false });
	assert.deepEqual(nested.tags, ['parent/child']);

	const flattened = await convertBearNote('#parent/child', { ...options, flattenTags: true });
	assert.deepEqual(flattened.tags, ['parent', 'child']);
});

test('drops a heading that only repeats the file name', async () => {
	const options = {
		basename: 'Title',
		parent: 'Title.textbundle',
		flattenTags: false,
		resolveAsset: async () => assert.fail('no assets here'),
	};

	assert.equal((await convertBearNote('# Title\nbody', options)).content, 'body');
	assert.equal((await convertBearNote('# Something else\nbody', options)).content, '# Something else\nbody');
});
