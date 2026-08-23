import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { LogseqImporter } from '../../src/formats/logseq';
import { ImportContext } from '../../src/import-context';
import { PickedFile } from '../../src/filesystem';
import { SourceFile, SourceFolder } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';

const FIXTURES = nodePath.join(__dirname, 'fixtures');

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

async function importer(graph: SourceFolder, output = 'Logseq') {
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

	assert.equal(ctx.notes, 7);
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
