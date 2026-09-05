import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeepImporter } from '../../src/formats/keep-json';
import { ImportContext } from '../../src/import-context';
import { SourceFile } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';

class TestingKeepImporter extends KeepImporter {
	override init(): void {}
}

function importer(vault: MemoryVault): TestingKeepImporter {
	return new TestingKeepImporter(
		memoryApp(vault),
		{ sourceEl: null, outputEl: null, optionsEl: null } as never,
	);
}

test('re-importing an unchanged Keep attachment does not create another copy', async () => {
	const vault = new MemoryVault();
	const attachment = new SourceFile('drawing.png', 'same bytes');

	const first = importer(vault);
	await first.ready;
	first.indexImportedNotes();
	const firstContext = new ImportContext();
	await first.importAttachment(attachment, vault.root, firstContext);

	const second = importer(vault);
	await second.ready;
	second.indexImportedNotes();
	const secondContext = new ImportContext();
	await second.importAttachment(attachment, vault.root, secondContext);

	assert.deepEqual(vault.paths(), ['drawing.png']);
	assert.equal(firstContext.attachments, 1);
	assert.deepEqual(secondContext.skipped, ['drawing.png']);
});

test('same-named Keep attachments with different bytes remain distinct', async () => {
	const vault = new MemoryVault();
	const subject = importer(vault);
	await subject.ready;
	subject.indexImportedNotes();

	await subject.importAttachment(new SourceFile('drawing.png', 'first'), vault.root, new ImportContext());
	await subject.importAttachment(new SourceFile('drawing.png', 'second'), vault.root, new ImportContext());

	assert.deepEqual(vault.paths(), ['drawing.png', 'drawing 1.png']);
});
