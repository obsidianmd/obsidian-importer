import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HtmlImporter } from '../../src/formats/html';
import { ImportContext } from '../../src/import-context';
import { indexedApp, MemoryVault } from '../shims/vault';
import { zipOf } from '../shims/zip';

function importer(): { vault: MemoryVault, subject: HtmlImporter } {
	const vault = new MemoryVault();
	const subject = new HtmlImporter(indexedApp(vault) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);

	return { vault, subject };
}

test('a zip is imported as the HTML tree it holds', async () => {
	const { vault, subject } = importer();
	await subject.ready;
	subject.chosen = [await zipOf({
		'Site/Index.html': '<main><a href="Pages/About.html">About</a></main>',
		'Site/Pages/About.html': '<main><p>About this site.</p></main>',
		'Site/style.css': 'body {}',
	})];
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

	assert.deepEqual(vault.paths(), [
		'Import/Site/Index.md',
		'Import/Site/Pages/About.md',
	]);
	assert.equal(vault.contents.get('Import/Site/Index.md'), '[[About]]');
});

test('attachments beside zipped pages are imported from the archive', async () => {
	const { vault, subject } = importer();
	await subject.ready;
	subject.minimumImageSize = 0;
	subject.chosen = [await zipOf({
		'Site/Index.html': '<main><p>Home</p><img src="cover.png"></main>',
		'Site/cover.png': 'image bytes',
	})];
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

	assert.ok(vault.paths().some(path => path.endsWith('cover.png')));
	const markdown = vault.contents.get('Import/Site/Index.md');
	if (typeof markdown !== 'string') assert.fail('expected imported Markdown');
	assert.match(markdown, /!\[\[cover\]\]/);
});
