import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PickedFile, PickedFolder } from '../../src/filesystem';
import { HtmlImporter } from '../../src/formats/html';
import { ImportContext } from '../../src/import-context';
import { SourceFile, SourceFolder } from '../shims/picked';
import { indexedApp, MemoryVault } from '../shims/vault';

function importer(): { vault: MemoryVault, subject: HtmlImporter } {
	const vault = new MemoryVault();
	const subject = new HtmlImporter(indexedApp(vault) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);

	return { vault, subject };
}

async function importing(subject: HtmlImporter, chosen: (PickedFile | PickedFolder)[]): Promise<ImportContext> {
	await subject.ready;
	subject.chosen = chosen;
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

	return ctx;
}

function site(): SourceFolder {
	return new SourceFolder('Site', [
		new SourceFile('Index.html', '<p><a href="Pages/About.html">About</a></p>'),
		new SourceFolder('Pages', [new SourceFile('About.html', '<h1>About</h1>')]),
	]);
}

test('a chosen HTML folder keeps its source structure', async () => {
	const { vault, subject } = importer();

	await importing(subject, [site()]);

	assert.deepEqual(vault.paths(), [
		'Import/Site/Index.md',
		'Import/Site/Pages/About.md',
	]);
});

test('planned source paths resolve links without waiting for the metadata cache', async () => {
	const { vault, subject } = importer();
	const app = subject.app as unknown as { metadataCache: { onCleanCache(): void } };
	app.metadataCache.onCleanCache = () => assert.fail('should not wait for the metadata cache');

	await importing(subject, [site()]);

	assert.equal(vault.contents.get('Import/Site/Index.md'), '[[About]]');
});

test('the final link pass rewrites imported attachment embeds', async () => {
	const { vault, subject } = importer();
	subject.downloadAttachment = async () => await vault.createBinary(
		'Import/image.png', new Uint8Array([1]).buffer);

	await importing(subject, [
		new SourceFile('Page.html', '<p><img src="https://example.com/image.png"></p>'),
	]);

	const markdown = String(vault.contents.get('Import/Page.md'));
	assert.match(markdown, /^!\[\[/u);
	assert.doesNotMatch(markdown, /Import\/image\.png/u);
});

test('case-distinct source pages resolve to their respective planned notes', async () => {
	const { vault, subject } = importer();
	const source = new SourceFolder('Site', [
		new SourceFile('Index.html', '<p><a href="A.html">upper</a> and <a href="a.html">lower</a></p>'),
		new SourceFile('A.html', '<p>upper</p>'),
		new SourceFile('a.html', '<p>lower</p>'),
	]);

	await importing(subject, [source]);

	assert.deepEqual(vault.paths(), [
		'Import/Site/Index.md',
		'Import/Site/A.md',
		'Import/Site/a 1.md',
	]);
	assert.equal(vault.contents.get('Import/Site/Index.md'), '[[A|upper]] and [[a 1|lower]]');
});

test('re-importing the same folder reuses the notes it planned before conversion', async () => {
	const { vault, subject } = importer();

	const first = await importing(subject, [site()]);
	const second = await importing(subject, [site()]);

	assert.deepEqual(vault.paths(), [
		'Import/Site/Index.md',
		'Import/Site/Pages/About.md',
	]);
	assert.equal(first.notes, 2);
	assert.equal(second.notes, 0);
	assert.deepEqual(second.skipped, ['Index', 'About']);
});

test('source folder casing follows an existing vault folder', async () => {
	const { vault, subject } = importer();
	await vault.createFolder('Import');
	await vault.createFolder('Import/Site');

	await importing(subject, [new SourceFolder('site', [new SourceFile('Index.html', '<p>Home</p>')])]);

	assert.deepEqual(vault.paths(), ['Import/Site/Index.md']);
});

interface PickerInternals {
	picker: { nodes: { path: string, selected: boolean, children?: unknown[] }[] };
}

test('an unticked HTML folder and its pages are excluded', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	internals.picker = {
		nodes: [{
			path: 'Site',
			selected: true,
			children: [{ path: 'Site/Pages', selected: false, children: [] }],
		}],
	} as PickerInternals['picker'];

	await importing(subject, [site()]);

	assert.deepEqual(vault.paths(), ['Import/Site/Index.md']);
});
