import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DuplicateHandling } from '../../src/format-importer';
import { EvernoteEnexImporter } from '../../src/formats/evernote-enex';
import { EvernoteOutput } from '../../src/formats/evernote/output';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

function outputOf(vault: MemoryVault, duplicateHandling: DuplicateHandling): EvernoteOutput {
	const importer = new EvernoteEnexImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	importer.duplicateHandling = duplicateHandling;
	importer.indexImportedNotes();

	return (importer as never as { outputInto(ctx: ImportContext): EvernoteOutput })
		.outputInto(new ImportContext());
}

test('a notebook going into the vault root is not named "//Notebook"', () => {
	const vault = new MemoryVault();

	assert.equal(outputOf(vault, DuplicateHandling.Update).planFolder('/', 'Inbox'), 'Inbox');
});

test('a second copy at the vault root gets its own folder', () => {
	const vault = new MemoryVault();
	vault.createFolder('Inbox');

	assert.equal(outputOf(vault, DuplicateHandling.CreateCopy).planFolder('/', 'Inbox'), 'Inbox 1');
});

test('a second copy below the output folder gets its own folder', () => {
	const vault = new MemoryVault();
	vault.createFolder('Evernote');
	vault.createFolder('Evernote/Inbox');

	assert.equal(outputOf(vault, DuplicateHandling.CreateCopy).planFolder('Evernote', 'Inbox'), 'Evernote/Inbox 1');
});

test('an import bringing a notebook up to date spells the folder the way the vault does', () => {
	const vault = new MemoryVault();
	vault.createFolder('Evernote');
	vault.createFolder('Evernote/inbox');

	assert.equal(outputOf(vault, DuplicateHandling.Update).planFolder('Evernote', 'Inbox'), 'Evernote/inbox');
});

test('a notebook no import has made keeps the name the export gave it', () => {
	const vault = new MemoryVault();
	vault.createFolder('Evernote');

	assert.equal(outputOf(vault, DuplicateHandling.Update).planFolder('Evernote', 'Inbox'), 'Evernote/Inbox');
});

test('two notebooks of one name in a single import do not share a folder', () => {
	const vault = new MemoryVault();
	const output = outputOf(vault, DuplicateHandling.CreateCopy);

	assert.equal(output.planFolder('Evernote', 'Inbox'), 'Evernote/Inbox');
	assert.equal(output.planFolder('Evernote', 'Inbox'), 'Evernote/Inbox 1');
});
