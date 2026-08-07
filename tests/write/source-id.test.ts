/**
 * Recognising a note an earlier import wrote.
 *
 * Three importers carry an id from the source into the note - apple-notes-id,
 * notion-id, airtable-id - so that a later import knows which note is which. A
 * file name cannot tell them that: two records share a title, and a note gets
 * renamed. All three read it back through the same pair of helpers now, which
 * is what this covers.
 *
 * Notion read it with a regex over the whole note until this was shared, so the
 * cases below that concern where the property is found are the ones that
 * changed: a line in the body is not frontmatter.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { serializeFrontMatter } from '../../src/util';
import { MemoryVault, memoryApp } from '../shims/vault';

/** Exposes the two helpers, which are protected for importers to use. */
class ReadingImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}

	idIn(content: string, property: string) {
		return this.sourceIdIn(content, property);
	}

	noteFrom(path: string, property: string, id: string) {
		return this.noteImportedFrom(path, property, id);
	}
}

function importer() {
	const vault = new MemoryVault();
	return { vault, subject: new ReadingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never) };
}

const NOTE = serializeFrontMatter({ 'notion-id': 'abc-123' }) + 'The body of the note.\n';

test('the id is read out of the note frontmatter', () => {
	const { subject } = importer();

	assert.equal(subject.idIn(NOTE, 'notion-id'), 'abc-123');
});

test('a note that carries no id, or a different property, reads as none', () => {
	const { subject } = importer();

	assert.equal(subject.idIn('Just a body.\n', 'notion-id'), null);
	assert.equal(subject.idIn(NOTE, 'airtable-id'), null);
});

test('the property has to be frontmatter, not a line that looks like it', () => {
	// A regex over the whole note found this and read the note as already
	// imported, which skipped a page that had never been written.
	const { subject } = importer();
	const body = 'How the import works:\n\nnotion-id: abc-123\n';

	assert.equal(subject.idIn(body, 'notion-id'), null);
});

test('the property has to be frontmatter, not a line inside a code block', () => {
	const { subject } = importer();
	const fenced = '# Notes\n\n```yaml\nnotion-id: abc-123\n```\n';

	assert.equal(subject.idIn(fenced, 'notion-id'), null);
});

test('a value that is not text is no id', () => {
	const { subject } = importer();

	assert.equal(subject.idIn(serializeFrontMatter({ 'notion-id': 42 } as never), 'notion-id'), null);
});

test('the note at a path is returned when its id is the one asked for', async () => {
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', NOTE);

	const found = await subject.noteFrom('Pages/Roadmap.md', 'notion-id', 'abc-123');

	assert.equal(found?.path, 'Pages/Roadmap.md');
});

test('a note carrying a different id is a different note', async () => {
	// It shares the name and nothing else, so the import writes its own.
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', NOTE);

	assert.equal(await subject.noteFrom('Pages/Roadmap.md', 'notion-id', 'def-456'), null);
});

test('nothing at the path is nothing to recognise', async () => {
	const { subject } = importer();

	assert.equal(await subject.noteFrom('Pages/Missing.md', 'notion-id', 'abc-123'), null);
});

test('a path differing only in case finds the note', async () => {
	// On macOS and Windows it is the same file. An exact lookup would report
	// no note there, and the import would write a second one over it.
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', NOTE);

	const found = await subject.noteFrom('pages/roadmap.md', 'notion-id', 'abc-123');

	assert.equal(found?.path, 'Pages/Roadmap.md');
});
