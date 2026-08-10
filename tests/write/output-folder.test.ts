/**
 * Where an import lands, when the folder is already there.
 *
 * Shared by every importer, so a folder the vault spells differently from what
 * the output setting says has to be recognised rather than created again: the
 * app throws "Folder already exists." for a name that differs only in case, and
 * an import that let that throw escape reported nothing at all (#377).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

class OutputImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}
}

function importer(outputLocation: string, configure?: (vault: MemoryVault) => void) {
	const vault = new MemoryVault();
	configure?.(vault);
	const subject = new OutputImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.outputLocation = outputLocation;

	return { vault, subject };
}

test('a folder that is not there yet is created', async () => {
	const { subject } = importer('Google Keep');

	const folder = await subject.getOutputFolder();

	assert.equal(folder?.path, 'Google Keep');
});

test('a folder that is already there is used as it is', async () => {
	const { subject } = importer('Google Keep', vault => void vault.createFolder('Google Keep'));

	const folder = await subject.getOutputFolder();

	assert.equal(folder?.path, 'Google Keep');
});

test('a folder that differs only in case is the same folder', async () => {
	const { vault, subject } = importer('Keep', vault => void vault.createFolder('keep'));

	const folder = await subject.getOutputFolder();

	assert.equal(folder?.path, 'keep');
	assert.deepEqual(vault.getAllLoadedFiles().map(entry => entry.path), ['/', 'keep']);
});

test('a path the setting spells loosely still finds the folder', async () => {
	const { subject } = importer('/Keep/', vault => void vault.createFolder('Keep'));

	const folder = await subject.getOutputFolder();

	assert.equal(folder?.path, 'Keep');
});

test('an empty setting is the top of the vault', async () => {
	const { vault, subject } = importer('');

	assert.equal(await subject.getOutputFolder(), vault.root);
});
