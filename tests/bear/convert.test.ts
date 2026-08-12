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

				const { content } = await convertBearNote(note.text ?? '', {
					basename,
					parent: note.parent,
					flattenTags: false,
					tagPlacement: 'inline',
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

const noteOptions = {
	basename: 'note',
	parent: 'note.textbundle',
	flattenTags: false,
	tagPlacement: 'inline' as const,
	resolveAsset: async () => assert.fail('no assets here'),
};

test('splits a nested tag when asked to', async () => {
	const nested = await convertBearNote('#parent/child', { ...noteOptions, flattenTags: false });
	assert.deepEqual(nested.tags, ['parent/child']);

	const flattened = await convertBearNote('#parent/child', { ...noteOptions, flattenTags: true });
	assert.deepEqual(flattened.tags, ['parent', 'child']);
});

test('drops a heading that only repeats the file name', async () => {
	const options = { ...noteOptions, basename: 'Title', parent: 'Title.textbundle' };

	assert.equal((await convertBearNote('# Title\nbody', options)).content, 'body');
	assert.equal((await convertBearNote('# Something else\nbody', options)).content, '# Something else\nbody');
});

test('a tag ends before the punctuation that follows it', async () => {
	const source = 'A tag like #bear, or #bear/welcome. And #bad!tag inside.';
	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, 'A tag like #bear, or #bear/welcome. And #bad_tag inside.');
	assert.deepEqual(tags, ['bear', 'bear/welcome', 'bad_tag']);
});

test('a hash Bear escaped is text, not a tag', async () => {
	const source = 'the tags **\\#errands**, and **\\#welcome notes\\#** are examples';
	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, source);
	assert.deepEqual(tags, []);
});

test('keeps tags where Bear wrote them, or moves them to the property', async () => {
	const source = 'Inline tags: #tag\n\nBody #two words# here.\n\n#bear/welcome';

	const inline = await convertBearNote(source, noteOptions);
	assert.equal(inline.content, 'Inline tags: #tag\n\nBody #two_words here.\n\n#bear/welcome');
	assert.deepEqual(inline.tags, ['tag', 'two_words', 'bear/welcome']);

	const moved = await convertBearNote(source, { ...noteOptions, tagPlacement: 'property' });
	assert.equal(moved.content, 'Inline tags:\n\nBody here.');
	assert.deepEqual(moved.tags, ['tag', 'two_words', 'bear/welcome']);
});

test('a hash in code is code, not a tag', async () => {
	const source = [
		'A colour `#00ff00` and a `#bad!tag` in a span.',
		'',
		'```css',
		'a { color: #00ff00 }',
		'#bad!tag',
		'```',
		'',
		'#real',
	].join('\n');

	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, source);
	assert.deepEqual(tags, ['real']);

	const moved = await convertBearNote(source, { ...noteOptions, tagPlacement: 'property' });
	assert.equal(moved.content, source.replace('\n\n#real', ''));
	assert.deepEqual(moved.tags, ['real']);
});

test('a code span that runs over a line ending is still code', async () => {
	const source = '`code\n#fake` and #real';
	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, source);
	assert.deepEqual(tags, ['real']);

	const moved = await convertBearNote(source, { ...noteOptions, tagPlacement: 'property' });
	assert.equal(moved.content, '`code\n#fake` and');
	assert.deepEqual(moved.tags, ['real']);
});

test('a code span closes on a run as long as the one that opened it', async () => {
	const source = '``foo `#fake`` and #real``';
	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, source);
	assert.deepEqual(tags, ['real']);
});

test('only a delimiter on a line of its own closes a fence', async () => {
	const source = '```md\n```js\n#fake\n```\n\n#real';
	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, source);
	assert.deepEqual(tags, ['real']);

	const moved = await convertBearNote(source, { ...noteOptions, tagPlacement: 'property' });
	assert.equal(moved.content, '```md\n```js\n#fake\n```');
	assert.deepEqual(moved.tags, ['real']);
});

test('four spaces in is code of another kind, not a fence', async () => {
	const source = '    ```\n#real';
	const moved = await convertBearNote(source, { ...noteOptions, tagPlacement: 'property' });

	assert.equal(moved.content, '    ```');
	assert.deepEqual(moved.tags, ['real']);
});

test('a table example inside a code span is left as it was written', async () => {
	const source = 'Write `Intro\n| a | b |\n|---|---|\n#fake` and then #real';
	const { content, tags } = await convertBearNote(source, noteOptions);

	assert.equal(content, source);
	assert.deepEqual(tags, ['real']);
});

test('a tag is found after any space, not only an ASCII one', async () => {
	const source = 'Tagged\u00a0#tag here';

	const inline = await convertBearNote(source, noteOptions);
	assert.deepEqual(inline.tags, ['tag']);

	const moved = await convertBearNote(source, { ...noteOptions, tagPlacement: 'property' });
	assert.equal(moved.content, 'Tagged here');
	assert.deepEqual(moved.tags, ['tag']);
});

test('a hex colour is not a tag', async () => {
	const { content, tags } = await convertBearNote('Use #00ff00 and #c0ffee, not #facade', noteOptions);

	assert.equal(content, 'Use #00ff00 and #c0ffee, not #facade');
	assert.deepEqual(tags, ['facade']);
});

test('writes Bear\'s underline as the tag Obsidian reads', async () => {
	const underlined = await convertBearNote('~underline~, ~~strikethrough~~, **B*I*~U~ button**', noteOptions);
	assert.equal(underlined.content, '<u>underline</u>, ~~strikethrough~~, **B*I*<u>U</u> button**');

	const paths = await convertBearNote('Look in ~/notes and ~/drafts, or `~x~`', noteOptions);
	assert.equal(paths.content, 'Look in ~/notes and ~/drafts, or `~x~`');

	const escaped = await convertBearNote('A \\~literal\\~ tilde', noteOptions);
	assert.equal(escaped.content, 'A \\~literal\\~ tilde');
});

test('separates a table from the paragraph above it', async () => {
	const table = '| a | b |\n|---|---|\n| 1 | 2 |';
	const options = { ...noteOptions, basename: 'Tables', parent: 'Tables.textbundle' };

	assert.equal((await convertBearNote(`Intro\n${table}`, options)).content, `Intro\n\n${table}`);
	assert.equal((await convertBearNote(`Intro\n\n${table}`, options)).content, `Intro\n\n${table}`);
	assert.equal((await convertBearNote(`\`\`\`\nIntro\n${table}\n\`\`\``, options)).content,
		`\`\`\`\nIntro\n${table}\n\`\`\``);
});

test('writes Bear\'s width comment as a width Obsidian reads', async () => {
	const options = { ...noteOptions, resolveAsset: async () => 'Bear/cat.png' };

	const sized = await convertBearNote('![](assets/cat.png)<!-- {"width":388} -->', options);
	assert.equal(sized.content, '![388](Bear/cat.png)');

	const described = await convertBearNote('![A cat](assets/cat.png)<!-- {"width":388} -->', options);
	assert.equal(described.content, '![A cat|388](Bear/cat.png)');

	const plain = await convertBearNote('![](assets/cat.png)', options);
	assert.equal(plain.content, '![](Bear/cat.png)');

	const documented = '```\n![](https://example.com/cat.png)<!-- {"width":388} -->\n```';
	assert.equal((await convertBearNote(documented, options)).content, documented);
});
