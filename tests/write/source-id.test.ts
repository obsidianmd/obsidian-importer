import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DuplicateHandling, FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { serializeFrontMatter } from '../../src/util';
import { MemoryVault, memoryApp } from '../shims/vault';

class ReadingImporter extends FormatImporter {
	init(): void {
		this.idProperty = 'notion-id';
	}

	async import(_ctx: ImportContext): Promise<void> {}

	idIn(content: string, property: string) {
		return this.sourceIdIn(content, property);
	}

	noteFrom(path: string, id?: string) {
		return this.previouslyImported(path, id);
	}

	claim(path: string) {
		this.claimPath(path);
	}
}

function importer() {
	const vault = new MemoryVault();
	const subject = new ReadingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = DuplicateHandling.Update;

	return { vault, subject };
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
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('Pages/Roadmap.md', 'abc-123')?.path, 'Pages/Roadmap.md');
});

test('a note carrying a different id is a different note', async () => {
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', NOTE);
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('Pages/Roadmap.md', 'def-456'), null);
});

test('nothing at the path is nothing to recognise', () => {
	const { subject } = importer();
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('Pages/Missing.md', 'abc-123'), null);
});

test('a path differing only in case finds the note', async () => {
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', NOTE);
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('pages/roadmap.md', 'abc-123')?.path, 'Pages/Roadmap.md');
});

test('the id finds the note wherever it has been renamed or moved to', async () => {
	const { vault, subject } = importer();
	await vault.create('Archive/Old plans.md', NOTE);
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('Pages/Roadmap.md', 'abc-123')?.path, 'Archive/Old plans.md');
});

test('a note carrying no id at all is still matched by its path', async () => {
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', 'No frontmatter here.\n');
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('Pages/Roadmap.md', 'abc-123')?.path, 'Pages/Roadmap.md');
});

test('a note this run has already written is never matched again', async () => {
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', 'Written by this run.\n');
	subject.indexImportedNotes();
	subject.claim('Pages/Roadmap.md');

	assert.equal(subject.noteFrom('Pages/Roadmap.md'), null);
});

test('an id no note in the vault carries is nothing to recognise', async () => {
	const { vault, subject } = importer();
	await vault.create('Pages/Roadmap.md', NOTE);
	subject.indexImportedNotes();

	assert.equal(subject.noteFrom('Pages/Elsewhere.md', 'def-456'), null);
});
