import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PickedFile, PickedFolder } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { HtmlImporter } from '../../src/formats/html';
import { ImportContext } from '../../src/import-context';
import { SourceFile, SourceFolder } from '../shims/picked';
import { indexedApp, MemoryVault } from '../shims/vault';

function importer(): { vault: MemoryVault, subject: HtmlImporter } {
	const vault = new MemoryVault();
	const subject = new HtmlImporter(indexedApp(vault) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);
	subject.saveSourceId = false;

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

test('the document title names the imported note', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile(
		'page-012345.html',
		'<title>A useful title</title><main><p>Body</p></main>',
	)]);

	assert.deepEqual(vault.paths(), ['Import/A useful title.md']);
});

test('links follow a target renamed from its document title', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Site', [
		new SourceFile('Index.html', '<main><a href="page-012345.html">Read it</a></main>'),
		new SourceFile(
			'page-012345.html',
			'<title>A useful title</title><main><p>Body</p></main>',
		),
	])]);

	assert.equal(vault.contents.get('Import/Site/Index.md'), '[[A useful title|Read it]]');
});

test('cross-page heading links use the target heading text', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Site', [
		new SourceFile('A.html', '<main><a href="B.html#sec">to B sec</a></main>'),
		new SourceFile('B.html', '<main><h2 id="sec">Section Two</h2></main>'),
	])]);

	assert.equal(vault.contents.get('Import/Site/A.md'), '[[B#Section Two|to B sec]]');
});

test('a same-page heading does not resolve to a sibling page named after its folder', async () => {
	const { vault, subject } = importer();

	await importing(subject, [
		new SourceFile('Site.html', '<title>Site Page</title><main><p>Other page</p></main>'),
		new SourceFolder('Site', [new SourceFile(
			'A.html',
			'<main><a href="#own">own</a><h2 id="own">Own Heading</h2></main>',
		)]),
	]);

	assert.equal(vault.contents.get('Import/Site/A.md'), '[[#Own Heading|own]]\n\n## Own Heading');
});

test('a changed document title updates the note identified by its source', async () => {
	const { vault, subject } = importer();
	subject.saveSourceId = true;

	await importing(subject, [new SourceFile(
		'Page.html', '<title>Draft title</title><main><p>Draft</p></main>')]);
	await importing(subject, [new SourceFile(
		'Page.html', '<title>Final title</title><main><p>Final</p></main>')]);

	assert.deepEqual(vault.paths(), ['Import/Draft title.md']);
	const updated = String(vault.contents.get('Import/Draft title.md'));
	assert.match(updated, /html-source: Page\.html/u);
	assert.match(updated, /Final/u);
});

test('an HTML-looking document title does not leave two extensions', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile(
		'Page.html', '<title>index.html</title><main><p>Body</p></main>')]);

	assert.deepEqual(vault.paths(), ['Import/index.md']);
});

test('cancelling metadata planning stops before the next document is read', async () => {
	const { vault, subject } = importer();
	const ctx = new ImportContext();
	let secondReads = 0;

	class CancellingFile extends SourceFile {
		async readText(): Promise<string> {
			const content = await super.readText();
			ctx.cancel();
			return content;
		}
	}
	class CountedFile extends SourceFile {
		async readText(): Promise<string> {
			secondReads++;
			return await super.readText();
		}
	}

	await subject.ready;
	subject.chosen = [
		new CancellingFile('A.html', '<title>A</title><p>A</p>'),
		new CountedFile('B.html', '<title>B</title><p>B</p>'),
	];
	subject.outputLocation = 'Import';
	subject.indexImportedNotes();
	await subject.import(ctx);

	assert.equal(secondReads, 0);
	assert.equal(ctx.progressCurrent, 1);
	assert.equal(ctx.progressTotal, 4);
	assert.deepEqual(vault.paths(), []);
});

test('planning and writing share one progress range', async () => {
	const { subject } = importer();
	const progress: [number, number][] = [];
	const ctx = new ImportContext();
	ctx.reportProgress = (current, total) => {
		progress.push([current, total]);
		ctx.progressCurrent = current;
		ctx.progressTotal = total;
	};

	await subject.ready;
	subject.chosen = [
		new SourceFile('A.html', '<p>A</p>'),
		new SourceFile('B.html', '<p>B</p>'),
	];
	subject.outputLocation = 'Import';
	subject.indexImportedNotes();
	await subject.import(ctx);

	assert.deepEqual(progress, [
		[0, 4],
		[1, 4],
		[2, 4],
		[3, 4],
		[4, 4],
	]);
});

test('asset-only source folders are not reproduced as empty vault folders', async () => {
	const { vault, subject } = importer();
	const source = new SourceFolder('Site', [
		new SourceFile('Index.html', '<p>Home</p>'),
		new SourceFolder('Index_files', [
			new SourceFile('style.css'),
			new SourceFolder('images', [new SourceFile('logo.png')]),
		]),
	]);

	await importing(subject, [source]);

	assert.deepEqual(vault.getAllLoadedFiles().map(file => file.path), [
		'/',
		'Import',
		'Import/Site',
		'Import/Site/Index.md',
	]);
});

test('an ignored source folder does not reserve a copy number', async () => {
	const { vault, subject } = importer();
	subject.duplicateHandling = DuplicateHandling.CreateCopy;

	await importing(subject, [
		new SourceFolder('Site', [new SourceFile('style.css')]),
		new SourceFolder('Site', [new SourceFile('Index.html', '<p>Home</p>')]),
	]);

	assert.deepEqual(vault.paths(), ['Import/Site/Index.md']);
});

test('a genuinely empty selected folder is preserved', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Site', [new SourceFolder('Empty', [])])]);

	assert.ok(vault.getAbstractFileByPath('Import/Site/Empty'));
	assert.deepEqual(vault.paths(), []);
});

test('planned source paths resolve links without waiting for the metadata cache', async () => {
	const { vault, subject } = importer();
	const app = subject.app as unknown as { metadataCache: { onCleanCache(): void } };
	app.metadataCache.onCleanCache = () => assert.fail('should not wait for the metadata cache');

	await importing(subject, [site()]);

	assert.equal(vault.contents.get('Import/Site/Index.md'), '[[About]]');
});

test('a root-relative link resolves within the chosen site root', async () => {
	const { vault, subject } = importer();
	const source = new SourceFolder('Site', [
		new SourceFile('Index.html', '<p><a href="/About.html">About</a></p>'),
		new SourceFile('About.html', '<h1>About</h1>'),
	]);

	await importing(subject, [source]);

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

test('same-named chosen roots merge consistently across re-imports', async () => {
	const { vault, subject } = importer();
	const roots = [
		new SourceFolder('Site', [new SourceFile('A.html', '<p>A</p>')]),
		new SourceFolder('Site', [new SourceFile('B.html', '<p>B</p>')]),
	];

	await importing(subject, roots);
	await importing(subject, roots);

	assert.deepEqual(vault.paths(), [
		'Import/Site/A.md',
		'Import/Site/B.md',
	]);
});

test('source folder casing follows an existing vault folder', async () => {
	const { vault, subject } = importer();
	await vault.createFolder('Import');
	await vault.createFolder('Import/Site');

	await importing(subject, [new SourceFolder('site', [new SourceFile('Index.html', '<p>Home</p>')])]);

	assert.deepEqual(vault.paths(), ['Import/Site/Index.md']);
});

interface PickerInternals {
	folderPicker: {
		selection(): { included: Set<string> | null, skipped: Set<string> };
	};
}

test('an unticked HTML folder and its pages are excluded', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	internals.folderPicker.selection = () => ({
		included: new Set(['Site']),
		skipped: new Set(['Site/Pages']),
	});

	await importing(subject, [site()]);

	assert.deepEqual(vault.paths(), ['Import/Site/Index.md']);
});

test('hidden descendant folders are ignored', async () => {
	const { vault, subject } = importer();
	const source = new SourceFolder('Site', [
		new SourceFile('Index.html', '<p>Home</p>'),
		new SourceFolder('.git', [new SourceFile('History.html', '<p>History</p>')]),
	]);

	await importing(subject, [source]);

	assert.deepEqual(vault.paths(), ['Import/Site/Index.md']);
});
