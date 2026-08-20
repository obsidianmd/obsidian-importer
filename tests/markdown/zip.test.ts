/**
 * A zip as a source, which is how a phone offers a folder.
 *
 * What it holds keeps its shape, and every entry has to be read before the
 * archive it came from is closed again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from '@zip.js/zip.js';

import { PickedFile } from '../../src/filesystem';
import { MarkdownImporter } from '../../src/formats/markdown';
import { ImportContext } from '../../src/import-context';
import { indexedApp, MemoryVault } from '../shims/vault';

class ZipFile implements PickedFile {
	readonly type = 'file' as const;
	readonly extension = 'zip';
	readonly basename: string;

	constructor(readonly name: string, private readonly blob: Blob) {
		this.basename = name.replace(/\.zip$/, '');
	}

	get fullpath(): string {
		return this.name;
	}

	async read(): Promise<ArrayBuffer> {
		return await this.blob.arrayBuffer();
	}

	async readText(): Promise<string> {
		throw new Error('not text');
	}

	async *readChunks(): AsyncIterable<string> {
		throw new Error('not text');
	}

	async readZip(callback: (zip: ZipReader<unknown>) => Promise<void>): Promise<void> {
		return await callback(new ZipReader(new BlobReader(this.blob)));
	}

	toString(): string {
		return this.name;
	}
}

async function zipOf(entries: Record<string, string>): Promise<ZipFile> {
	const writer = new ZipWriter(new BlobWriter('application/zip'));
	for (const [path, text] of Object.entries(entries)) {
		await writer.add(path, new TextReader(text));
	}

	return new ZipFile('Export.zip', await writer.close());
}

async function importing(zip: PickedFile): Promise<{ vault: MemoryVault, ctx: ImportContext }> {
	const vault = new MemoryVault();
	const subject = new MarkdownImporter(indexedApp(vault) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);

	await subject.ready;
	subject.chosen = [zip];
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

	return { vault, ctx };
}

test('a zip is imported as the folders it holds', async () => {
	const { vault } = await importing(await zipOf({
		'Notes/Index.md': '# Index\n',
		'Notes/cover.png': 'pretend this is a png',
		'Notes/Journal/Day.markdown': 'A day.\n',
	}));

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
	]);
});

test('what a zip holds is read before the archive closes', async () => {
	const { vault } = await importing(await zipOf({ 'Notes/Index.md': '# Index\n\nBody.\n' }));

	assert.equal(vault.contents.get('Import/Notes/Index.md'), '# Index\n\nBody.\n');
});

test('what macOS packs beside the folder is left out', async () => {
	const { vault } = await importing(await zipOf({
		'Notes/Index.md': '# Index\n',
		'Notes/.DS_Store': 'noise',
		'__MACOSX/Notes/._Index.md': 'noise',
	}));

	assert.deepEqual(vault.paths(), ['Import/Notes/Index.md']);
});

test('a zip with notes at its root lands them in the output folder', async () => {
	const { vault } = await importing(await zipOf({ 'One.md': 'one\n', 'Two.md': 'two\n' }));

	assert.deepEqual(vault.paths(), ['Import/One.md', 'Import/Two.md']);
});

test('the tree lists the folders a zip holds, and not the files', async () => {
	const vault = new MemoryVault();
	const subject = new MarkdownImporter(indexedApp(vault) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);

	await subject.ready;
	subject.chosen = [await zipOf({
		'Notes/Index.md': '# Index\n',
		'Notes/cover.png': 'a png',
		'Notes/Journal/Day.md': 'A day.\n',
		'Notes/Journal/Art/Sketch.png': 'a png',
	})];

	const internals = subject as unknown as {
		opened(items: unknown[], body: (items: unknown[]) => Promise<void>): Promise<void>,
	};

	let shape: unknown;
	await internals.opened(subject.chosen, async items => {
		shape = await folderShape(items as { type: string, name: string, list(): Promise<unknown[]> }[]);
	});

	assert.deepEqual(shape, [{ Notes: [{ Journal: [{ Art: [] }] }] }]);
});

async function folderShape(items: { type: string, name: string, list(): Promise<unknown[]> }[]): Promise<unknown[]> {
	const drawn = [];

	for (const item of items) {
		if (item.type !== 'folder') continue;
		drawn.push({ [item.name]: await folderShape(await item.list() as never) });
	}

	return drawn;
}

test('the top level is open, the rest closed, and all of it counted', async () => {
	const vault = new MemoryVault();
	const subject = new MarkdownImporter(indexedApp(vault) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);

	await subject.ready;
	subject.chosen = [await zipOf({
		'Notes/Index.md': '# Index\n',
		'Notes/cover.png': 'a png',
		'Notes/Journal/Day.md': 'A day.\n',
		'Notes/Journal/Later.markdown': 'Later.\n',
		'Notes/Journal/Art/Sketch.png': 'a png',
	})];

	const picker = {
		nodes: [] as CountedNode[],
		async load(walk: () => Promise<CountedNode[]>): Promise<void> {
			this.nodes = await walk();
		},
		reset(): void {
			this.nodes = [];
		},
	};

	const internals = subject as unknown as { loadFolders(): Promise<void>, picker: unknown };
	internals.picker = picker;
	await internals.loadFolders();

	assert.ok(picker.nodes.every(node => !node.collapsed), 'what was chosen starts open');
	assert.ok(picker.nodes.every(node => (node.children ?? []).every(child => child.collapsed)), 'what is under it does not');
	assert.ok(picker.nodes.every(node => node.selected), 'and all of it is ticked');

	assert.deepEqual(counted(picker.nodes), [
		{ Notes: [3, [{ Journal: [2, [{ Art: [0, []] }]] }]] },
	]);
});

interface CountedNode {
	title: string;
	notes: number;
	selected: boolean;
	collapsed?: boolean;
	children?: CountedNode[];
}

function counted(nodes: CountedNode[]): unknown[] {
	return nodes.map(node => ({ [node.title]: [node.notes, counted(node.children ?? [])] }));
}
