import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { LogseqImporter } from '../../src/formats/logseq';
import { ImportContext } from '../../src/import-context';
import { NodePickedFolder, PickedFile, PickedFolder, provideNodeModules } from '../../src/filesystem';
import { SourceFile, SourceFolder } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';
import { expectTree } from '../helpers';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

const FIXTURES = nodePath.join(__dirname, 'fixtures');
const EXPECTED = nodePath.join(__dirname, 'expected');

class BinarySourceFile implements PickedFile {
	readonly type = 'file' as const;
	readonly fullpath: string;
	readonly basename: string;
	readonly extension: string;

	constructor(readonly name: string, private readonly data: ArrayBuffer) {
		this.fullpath = name;
		const dot = name.lastIndexOf('.');
		this.basename = dot < 0 ? name : name.slice(0, dot);
		this.extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
	}

	async read(): Promise<ArrayBuffer> {
		return this.data;
	}

	async readText(): Promise<string> {
		return new TextDecoder().decode(this.data);
	}

	async *readChunks(): AsyncIterable<string> {
		yield await this.readText();
	}

	async readZip(): Promise<void> {
		throw new Error('Not a zip file');
	}

	toString(): string {
		return this.name;
	}
}

class UnreadableSourceFile extends BinarySourceFile {
	async read(): Promise<ArrayBuffer> {
		throw new Error('Could not read attachment');
	}
}

class CountingSourceFile extends BinarySourceFile {
	reads = 0;

	override async read(): Promise<ArrayBuffer> {
		this.reads++;
		return await super.read();
	}
}

class CancelAtCheckpoint extends ImportContext {
	private seen = 0;

	constructor(private readonly checkpoint: number) {
		super();
	}

	override async shouldStop(): Promise<boolean> {
		this.seen++;
		if (this.seen === this.checkpoint) this.cancel();
		return super.shouldStop();
	}
}

function fixtureFolder(name: string): SourceFolder {
	const path = nodePath.join(FIXTURES, name);
	return new SourceFolder(name, nodeFs.readdirSync(path).map(filename => {
		const data = nodeFs.readFileSync(nodePath.join(path, filename));
		return filename.endsWith('.md')
			? new SourceFile(filename, data.toString('utf8'))
			: new BinarySourceFile(filename, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
	}));
}

function fixtureGraph(): SourceFolder {
	return new SourceFolder('Fixture graph', [
		fixtureFolder('pages'),
		fixtureFolder('journals'),
		fixtureFolder('assets'),
	]);
}

function expectVault(vault: MemoryVault): void {
	const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'obsidian-importer-logseq-'));
	try {
		for (const [path, content] of vault.contents) {
			const target = nodePath.join(produced, path);
			nodeFs.mkdirSync(nodePath.dirname(target), { recursive: true });
			nodeFs.writeFileSync(target, typeof content === 'string' ? content : Buffer.from(content));
		}
		expectTree(produced, EXPECTED, 'Logseq fixture graph');
	}
	finally {
		nodeFs.rmSync(produced, { recursive: true, force: true });
	}
}

async function importer(graph: PickedFolder, output = 'Logseq') {
	const vault = new MemoryVault();
	const subject = new LogseqImporter(memoryApp(vault), {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		abortController: new AbortController(),
		importerId: 'logseq',
	} as never);
	await subject.ready;
	subject.chosen = [graph];
	subject.outputLocation = output;
	subject.options.useDailyNotes = false;
	subject.options.journalFolder = 'Journals';
	subject.indexImportedNotes();
	return { subject, vault };
}

test('imports a Logseq graph through the real importer and vault pipeline', async () => {
	const { subject, vault } = await importer(fixtureGraph());
	const ctx = new ImportContext();

	await subject.import(ctx);

	assert.equal(ctx.notes, 8);
	assert.equal(ctx.attachments, 2);
	assert.ok(vault.contents.has('Logseq/Main Page.md'));
	assert.ok(vault.contents.has('Logseq/Reference Page.md'));
	assert.ok(vault.contents.has('Logseq/algorithms/dynamic programming.md'));
	assert.ok(vault.contents.has('Logseq/algorithms/dynamic programming/memoization.md'));
	assert.ok(vault.contents.has('Logseq/Journals/2024-06-15.md'));
	assert.ok(vault.contents.has('diagram.png'));
	assert.ok(vault.contents.has('report.pdf'));

	const main = vault.contents.get('Logseq/Main Page.md');
	assert.ok(typeof main === 'string');
	assert.match(main, /logseq-source: Fixture graph\/pages\/Main Page\.md/);
	assert.match(main, /\[\[Logseq\/Reference Page#\^a1b2c3\]\]/);
	assert.match(main, /!\[\[diagram\.png\|600x400\]\]/);

	const journal = vault.contents.get('Logseq/Journals/2024-06-15.md');
	assert.ok(typeof journal === 'string');
	assert.match(journal, /\[\[Logseq\/Main Page\]\]/);
	assert.match(journal, /!\[\[diagram\.png\]\]/);

	expectVault(vault);
});

test('renames different same-basename assets and rewrites each note to its copy', async () => {
	const bytesA = new Uint8Array([1]).buffer;
	const bytesB = new Uint8Array([2]).buffer;
	const graph = new SourceFolder('Colliding assets', [
		new SourceFolder('pages', [
			new SourceFile('A.md', '- ![](../assets/a/image.png)'),
			new SourceFile('B.md', '- ![](../assets/b/image.png)'),
		]),
		new SourceFolder('assets', [
			new SourceFolder('a', [new BinarySourceFile('image.png', bytesA)]),
			new SourceFolder('b', [new BinarySourceFile('image.png', bytesB)]),
		]),
	]);
	const { subject, vault } = await importer(graph);

	await subject.import(new ImportContext());

	assert.deepEqual(vault.paths().filter(path => path.endsWith('.png')), ['image.png', 'image 1.png']);
	assert.match(vault.contents.get('Logseq/A.md') as string, /!\[\[image\.png\]\]/);
	assert.match(vault.contents.get('Logseq/B.md') as string, /!\[\[image 1\.png\]\]/);
});

test('replans title templates with final collision-safe asset links', async () => {
	const asset = new BinarySourceFile('image.png', new Uint8Array([1]).buffer);
	const graph = new SourceFolder('Templated asset', [
		new SourceFolder('pages', [new SourceFile('A.md', '- ![](../assets/image.png)')]),
		new SourceFolder('assets', [asset]),
	]);
	const { subject, vault } = await importer(graph);
	await vault.createBinary('image.png', new Uint8Array([9]).buffer);

	const seen: string[] = [];
	const internal = subject as unknown as {
		configuredNoteTitle: (...args: unknown[]) => Promise<string>;
	};
	const configured = internal.configuredNoteTitle.bind(subject);
	internal.configuredNoteTitle = async (...args: unknown[]) => {
		seen.push(args[2] as string);
		return await configured(...args);
	};

	await subject.import(new ImportContext());

	assert.match(seen[0], /!\[\]\(\.\.\/assets\/image\.png\)/);
	assert.match(seen.at(-1) ?? '', /!\[\[image 1\.png\]\]/);
});

test('does not retain attachment bytes between planning and writing', async () => {
	const asset = new CountingSourceFile('image.png', new Uint8Array([1]).buffer);
	const graph = new SourceFolder('Lazy asset', [
		new SourceFolder('pages', [new SourceFile('A.md', '- ![](../assets/image.png)')]),
		new SourceFolder('assets', [asset]),
	]);
	const { subject } = await importer(graph);

	await subject.import(new ImportContext());

	assert.equal(asset.reads, 2, 'asset is read for dedupe, released, then read again only when written');
});

test('preserves source timestamps on notes and copied attachments', async t => {
	const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'logseq-times-'));
	t.after(() => nodeFs.rmSync(directory, { recursive: true, force: true }));
	nodeFs.mkdirSync(nodePath.join(directory, 'pages'));
	nodeFs.mkdirSync(nodePath.join(directory, 'assets'));
	const notePath = nodePath.join(directory, 'pages', 'A.md');
	const assetPath = nodePath.join(directory, 'assets', 'image.png');
	nodeFs.writeFileSync(notePath, '- ![](../assets/image.png)');
	nodeFs.writeFileSync(assetPath, 'image');
	const modified = new Date('2020-01-02T03:04:05.000Z');
	nodeFs.utimesSync(notePath, modified, modified);
	nodeFs.utimesSync(assetPath, modified, modified);

	const { subject, vault } = await importer(new NodePickedFolder(directory));
	await subject.import(new ImportContext());

	const note = vault.getAbstractFileByPath('Logseq/A.md') as unknown as { stat: { mtime: number } };
	const asset = vault.getAbstractFileByPath('image.png') as unknown as { stat: { mtime: number } };
	assert.equal(note.stat.mtime, modified.getTime());
	assert.equal(asset.stat.mtime, modified.getTime());
});

test('reports and does not traverse a graph whiteboards folder', async () => {
	const graph = new SourceFolder('Whiteboard graph', [
		new SourceFolder('pages', [new SourceFile('A.md', '- A')]),
		new SourceFolder('whiteboards', [new UnreadableSourceFile('board.edn', new ArrayBuffer(0))]),
	]);
	const { subject } = await importer(graph);
	const ctx = new ImportContext();

	await subject.import(ctx);

	assert.deepEqual(ctx.skipped, ['whiteboards']);
	assert.equal(ctx.failed.length, 0);
	assert.equal(ctx.log[0].reason, 'Logseq whiteboards are not supported by Obsidian');
});

test('does not retarget a bare page name to a namespaced page', async () => {
	const graph = new SourceFolder('Namespaced page', [
		new SourceFolder('pages', [
			new SourceFile('a___b.md', '- Namespaced B'),
			new SourceFile('Reference.md', '- Link to [[b]]'),
		]),
	]);
	const { subject, vault } = await importer(graph);

	await subject.import(new ImportContext());

	assert.match(vault.contents.get('Logseq/Reference.md') as string, /\[\[b\]\]/);
	assert.doesNotMatch(vault.contents.get('Logseq/Reference.md') as string, /\[\[Logseq\/a\/b/);
});

test('does not let an alias retarget links away from a real page', async () => {
	const graph = new SourceFolder('Alias shadow', [
		new SourceFolder('pages', [
			new SourceFile('Foo.md', ['alias:: Bar', '', '- Foo'].join('\n')),
			new SourceFile('Bar.md', '- Real Bar'),
			new SourceFile('Reference.md', '- Link to [[Bar]]'),
		]),
	]);
	const { subject, vault } = await importer(graph);

	await subject.import(new ImportContext());

	const reference = vault.contents.get('Logseq/Reference.md') as string;
	assert.match(reference, /\[\[Logseq\/Bar\]\]/);
	assert.doesNotMatch(reference, /\[\[Logseq\/Foo\|Bar\]\]/);
});

test('keeps slash-formatted journals in their date folders', async () => {
	const graph = new SourceFolder('Journal folders', [
		new SourceFolder('journals', [
			new SourceFile('2024_06_15.md', '- First journal'),
			new SourceFile('2024_07_15.md', '- Second journal'),
		]),
	]);
	const { subject, vault } = await importer(graph);
	subject.options.useDailyNotes = true;
	subject.options.journalFolder = 'Daily';
	subject.options.journalDateFormat = 'YYYY/MM/DD';

	await subject.import(new ImportContext());

	assert.ok(vault.contents.has('Daily/2024/06/15.md'));
	assert.ok(vault.contents.has('Daily/2024/07/15.md'));
});

test('sanitizes every namespace folder and rewrites links to the planned path', async () => {
	const graph = new SourceFolder('Sanitized namespace', [
		new SourceFolder('pages', [
			new SourceFile('Ask%3F%20Me.md', '- Parent'),
			new SourceFile('Ask%3F%20Me___Child.md', '- Child'),
			new SourceFile('Reference.md', '- [[Ask%3F%20Me___Child]]'),
		]),
	]);
	const { subject, vault } = await importer(graph);

	await subject.import(new ImportContext());

	assert.ok(vault.contents.has('Logseq/Ask Me.md'));
	assert.ok(vault.contents.has('Logseq/Ask Me/Child.md'));
	assert.match(vault.contents.get('Logseq/Reference.md') as string, /\[\[Logseq\/Ask Me\/Child\]\]/);
});

test('preserves a missing asset link and reports it', async () => {
	const graph = new SourceFolder('Missing asset', [
		new SourceFolder('pages', [new SourceFile('A.md', '- ![missing](../assets/missing.png)')]),
	]);
	const { subject, vault } = await importer(graph);
	const ctx = new ImportContext();

	await subject.import(ctx);

	assert.match(vault.contents.get('Logseq/A.md') as string, /!\[missing\]\(\.\.\/assets\/missing\.png\)/);
	assert.deepEqual(ctx.skipped, ['../assets/missing.png']);
});

test('keeps importing when an attachment cannot be read', async () => {
	const graph = new SourceFolder('Unreadable asset', [
		new SourceFolder('pages', [
			new SourceFile('A.md', '- ![unreadable](../assets/unreadable.png)'),
			new SourceFile('B.md', '- Still imported'),
		]),
		new SourceFolder('assets', [new UnreadableSourceFile('unreadable.png', new ArrayBuffer(0))]),
	]);
	const { subject, vault } = await importer(graph);
	const ctx = new ImportContext();

	await subject.import(ctx);

	assert.equal(ctx.notes, 2);
	assert.deepEqual(ctx.failed, ['assets/unreadable.png']);
	assert.match(vault.contents.get('Logseq/A.md') as string,
		/!\[unreadable\]\(\.\.\/assets\/unreadable\.png\)/);
	assert.ok(vault.contents.has('Logseq/B.md'));
});

test('can be cancelled during attachment planning without writing partial output', async () => {
	const graph = new SourceFolder('Cancelled graph', [
		new SourceFolder('pages', [new SourceFile('A.md', '- ![](../assets/image.png)')]),
		new SourceFolder('assets', [new BinarySourceFile('image.png', new Uint8Array([1]).buffer)]),
	]);
	const { subject, vault } = await importer(graph);
	const ctx = new CancelAtCheckpoint(2);

	await subject.import(ctx);

	assert.equal(ctx.isCancelled(), true);
	assert.equal(ctx.notes, 0);
	assert.equal(ctx.attachments, 0);
	assert.deepEqual(vault.paths(), []);
});
