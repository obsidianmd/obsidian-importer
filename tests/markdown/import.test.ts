import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { TFile, TFolder } from 'obsidian';

import { AndroidFilesystem, AndroidPickedFolder, NodePickedFile, PickedFile, PickedFolder, provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { MarkdownImporter } from '../../src/formats/markdown';
import { ImportContext } from '../../src/import-context';
import { SourceFile, SourceFolder } from '../shims/picked';
import { indexedApp, MemoryVault } from '../shims/vault';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

function importer(): { vault: MemoryVault, subject: MarkdownImporter } {
	const vault = new MemoryVault();
	const subject = new MarkdownImporter(indexedApp(vault) as never, { sourceEl: null, outputEl: null, optionsEl: null } as never);

	return { vault, subject };
}

async function importing(subject: MarkdownImporter, chosen: (PickedFile | PickedFolder)[]): Promise<ImportContext> {
	await subject.ready;
	subject.chosen = chosen;
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

	return ctx;
}

function notes(): SourceFolder {
	return new SourceFolder('Notes', [
		new SourceFile('Index.md', '# Index\n\n[A day](Journal?/Day.markdown)\n\n![](cover.png)\n'),
		new SourceFile('cover.png', 'pretend this is a png'),
		new SourceFolder('Journal?', [new SourceFile('Day.markdown', 'A day.\n')]),
	]);
}

test('a folder is imported as the folder it was', async () => {
	const { vault, subject } = importer();

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
	]);
});

test('an Android folder import preserves source file dates', async () => {
	const filesystem: AndroidFilesystem = {
		choose: async () => ({ path: '', uri: '', isRoot: false }),
		checkPerms: async () => {},
		requestPerms: async () => {},
		readdir: async () => ({
			files: [{
				name: 'Index.md',
				type: 'file',
				size: 7,
				ctime: 1_700_000_000_000,
				mtime: 1_710_000_000_000,
			}],
		}),
		readFile: async () => ({ data: Buffer.from('# Index').toString('base64') }),
	};
	const source = new AndroidPickedFolder('/storage/emulated/0/Documents/Notes', filesystem);
	const { vault, subject } = importer();

	await importing(subject, [source]);

	const imported = vault.getAbstractFileByPath('Import/Notes/Index.md');
	assert.ok(imported instanceof TFile);
	assert.equal(imported.stat.ctime, 1_700_000_000_000);
	assert.equal(imported.stat.mtime, 1_710_000_000_000);
});

test('a link is rewritten in this vault\'s form, still reaching the note it named', async () => {
	const { vault, subject } = importer();

	await importing(subject, [notes()]);

	assert.equal(vault.contents.get('Import/Notes/Index.md'), '# Index\n\n[[Day|A day]]\n\n![](cover.png)\n');
});

test('source link syntax is kept while a renamed target is repaired', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.standardizeFormatting = false;
	await importing(subject, [notes()]);

	assert.equal(vault.contents.get('Import/Notes/Index.md'), '# Index\n\n[A day](Journal/Day.md)\n\n![](cover.png)\n');
});

test('an absolute source link is repaired after its tree moves under the output folder', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.standardizeFormatting = false;
	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('Index.md', '[[/Notes/Target]]\n'),
		new SourceFile('Target.md', 'Target.\n'),
	])]);

	assert.equal(vault.contents.get('Import/Notes/Index.md'), '[[Target]]\n');
});

test('a folder holding nothing is still made', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('One.md', 'one'),
		new SourceFolder('Later', []),
	])]);

	assert.ok(vault.getAbstractFileByPath('Import/Notes/Later') instanceof TFolder);
	assert.deepEqual(vault.paths(), ['Import/Notes/One.md']);
});

test('files chosen on their own land in the output folder', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile('One.md', 'one'), new SourceFile('Two.markdown', 'two')]);

	assert.deepEqual(vault.paths(), ['Import/One.md', 'Import/Two.md']);
});

test('importing the same folder again lands on the notes it wrote', async () => {
	const { vault, subject } = importer();

	const first = await importing(subject, [notes()]);
	const second = await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
	]);
	assert.equal(first.notes, 2);
	assert.equal(second.notes, 0);
	assert.deepEqual(second.skipped, ['Index', 'cover.png', 'Day']);
});

test('an unrelated same-sized attachment is left alone', async () => {
	const { vault, subject } = importer();
	await vault.createFolder('Import');
	await vault.createFolder('Import/Notes');
	await vault.createBinary('Import/Notes/cover.png', new TextEncoder().encode('MINE').buffer);

	await importing(subject, [new SourceFolder('Notes', [new SourceFile('cover.png', 'SRC!')])]);

	assert.deepEqual(vault.paths(), ['Import/Notes/cover.png', 'Import/Notes/cover 1.png']);
	assert.equal(new TextDecoder().decode(vault.contents.get('Import/Notes/cover.png') as ArrayBuffer), 'MINE');
	assert.equal(new TextDecoder().decode(vault.contents.get('Import/Notes/cover 1.png') as ArrayBuffer), 'SRC!');
});

test('attachments whose names sanitize alike reuse their own candidates', async () => {
	const { vault, subject } = importer();
	const source = new SourceFolder('Notes', [
		new SourceFile('pic?.png', 'first'),
		new SourceFile('pic:.png', 'second'),
	]);

	for (let round = 1; round <= 3; round++) {
		await importing(subject, [source]);
		assert.deepEqual(vault.paths(), ['Import/Notes/pic.png', 'Import/Notes/pic 1.png'], `round ${round}`);
	}
});

test('a changed attachment without stable times adds one version, not one per import', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile('photo.png', 'first')]);
	await importing(subject, [new SourceFile('photo.png', 'changed')]);
	await importing(subject, [new SourceFile('photo.png', 'changed')]);

	assert.deepEqual(vault.paths(), ['Import/photo.png', 'Import/photo 1.png']);
});

test('case-distinct source links resolve to their respective planned notes', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('Index.md', '[[A]] and [[a]]\n'),
		new SourceFile('A.md', 'upper\n'),
		new SourceFile('a.md', 'lower\n'),
	])]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/A.md',
		'Import/Notes/a 1.md',
	]);
	assert.equal(vault.contents.get('Import/Notes/Index.md'), '[[A]] and [[a 1]]\n');
});

test('source folder casing is canonicalized to an existing vault folder', async () => {
	const { vault, subject } = importer();
	await vault.createFolder('Import');
	await vault.createFolder('Import/Notes');

	await importing(subject, [new SourceFolder('notes', [new SourceFile('One.md', 'one\n')])]);

	assert.deepEqual(vault.paths(), ['Import/Notes/One.md']);
});

test('a changed local attachment is rewritten in place', async t => {
	const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'markdown-attachment-'));
	t.after(() => nodeFs.rmSync(directory, { recursive: true }));
	const sourcePath = nodePath.join(directory, 'photo.png');
	nodeFs.writeFileSync(sourcePath, 'first');

	const { vault, subject } = importer();
	const source = new NodePickedFile(sourcePath);
	await importing(subject, [source]);

	nodeFs.writeFileSync(sourcePath, 'changed');
	const later = new Date(Date.now() + 5_000);
	nodeFs.utimesSync(sourcePath, later, later);
	await importing(subject, [source]);

	assert.deepEqual(vault.paths(), ['Import/photo.png']);
	assert.equal(new TextDecoder().decode(vault.contents.get('Import/photo.png') as ArrayBuffer), 'changed');
});

test('Skip leaves a changed local attachment alone', async t => {
	const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'markdown-attachment-'));
	t.after(() => nodeFs.rmSync(directory, { recursive: true }));
	const sourcePath = nodePath.join(directory, 'photo.png');
	nodeFs.writeFileSync(sourcePath, 'first');

	const { vault, subject } = importer();
	const source = new NodePickedFile(sourcePath);
	await importing(subject, [source]);

	subject.duplicateHandling = DuplicateHandling.Skip;
	nodeFs.writeFileSync(sourcePath, 'changed');
	const later = new Date(Date.now() + 5_000);
	nodeFs.utimesSync(sourcePath, later, later);
	const second = await importing(subject, [source]);

	assert.deepEqual(vault.paths(), ['Import/photo.png']);
	assert.equal(new TextDecoder().decode(vault.contents.get('Import/photo.png') as ArrayBuffer), 'first');
	assert.deepEqual(second.skipped, ['photo.png']);
});

test('asking for a copy numbers the folder rather than the notes inside it', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.duplicateHandling = DuplicateHandling.CreateCopy;

	await importing(subject, [notes()]);
	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
		'Import/Notes 1/Index.md',
		'Import/Notes 1/cover.png',
		'Import/Notes 1/Journal/Day.md',
	]);
});

const LISTS = '# Shopping\n\n* Bread\n    * Sourdough\n* Milk\n';

test('a list is written the way this vault writes one', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile('Shopping.md', LISTS)]);

	assert.equal(vault.contents.get('Import/Shopping.md'), '# Shopping\n\n- Bread\n    - Sourdough\n- Milk\n');
});

test('source list formatting is preserved when standardization is turned off', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.standardizeFormatting = false;
	const first = await importing(subject, [new SourceFile('Shopping.md', LISTS)]);
	await subject.finalizeMarkdownOutput();
	const second = await importing(subject, [new SourceFile('Shopping.md', LISTS)]);

	assert.equal(vault.contents.get('Import/Shopping.md'), LISTS);
	assert.equal(first.notes, 1);
	assert.equal(second.notes, 0);
	assert.deepEqual(second.skipped, ['Shopping']);
});

test('an unchanged source-formatted import does not run the Markdown link pass', async () => {
	const vault = new MemoryVault();
	const app = indexedApp(vault) as never as {
		metadataCache: { computeMetadataAsync(content: ArrayBuffer): Promise<unknown> };
	};
	const computeMetadata = app.metadataCache.computeMetadataAsync;
	let computations = 0;
	app.metadataCache.computeMetadataAsync = async content => {
		computations++;
		return await computeMetadata(content);
	};
	const subject = new MarkdownImporter(app as never, { sourceEl: null, outputEl: null, optionsEl: null } as never);

	await subject.ready;
	subject.standardizeFormatting = false;
	await importing(subject, [new SourceFile('Plain.md', 'No renamed paths here.\n')]);
	await importing(subject, [new SourceFile('Plain.md', 'No renamed paths here.\n')]);

	assert.equal(computations, 0);
});

interface PickerInternals {
	folderPicker: {
		selection(): { included: Set<string> | null, skipped: Set<string> };
	};
}

test('a folder left unticked is not imported, nor anything inside it', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	subject.chosen = [notes()];
	internals.folderPicker.selection = () => ({
		included: new Set(['Notes']),
		skipped: new Set(['Notes/Journal?']),
	});

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Index.md', 'Import/Notes/cover.png']);
});

test('a folder ticked under one that is not brings only itself', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	internals.folderPicker.selection = () => ({
		included: new Set(['Notes/Journal?']),
		skipped: new Set(),
	});

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Journal/Day.md']);
});

test('unticking the folder that was chosen leaves the import empty', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	internals.folderPicker.selection = () => ({ included: new Set(), skipped: new Set(['Notes']) });

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), []);
});

test('what a vault keeps for itself is left behind', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('Index.md', 'one'),
		new SourceFile('.DS_Store', 'noise'),
		new SourceFolder('.obsidian', [new SourceFile('app.json', '{}')]),
		new SourceFolder('.git', [new SourceFile('HEAD', 'ref')]),
	])]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Index.md']);
});

test('a hidden folder picked on purpose is the one thing that is imported', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('.obsidian', [new SourceFile('app.json', '{}')])]);

	assert.deepEqual(vault.paths(), ['Import/obsidian/app.json']);
});

test('a base and a canvas come across as they were written', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('Books.base', 'filters:\n  and: []\n'),
		new SourceFile('Map.canvas', '{"nodes":[]}'),
	])]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Books.base', 'Import/Notes/Map.canvas']);
	const canvas = vault.contents.get('Import/Notes/Map.canvas') as ArrayBuffer;
	assert.equal(new TextDecoder().decode(canvas), '{"nodes":[]}');
});
