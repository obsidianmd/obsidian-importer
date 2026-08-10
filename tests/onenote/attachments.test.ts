import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OneNoteImporter } from '../../src/formats/onenote';
import { ImportContext } from '../../src/import-context';
import { DuplicateHandling } from '../../src/format-importer';
import { DEFAULT_DATA } from '../../src/plugin-data';
import type { ImporterData } from '../../src/plugin-data';
import { MemoryVault, memoryApp } from '../shims/vault';

function importer(download: (name: string) => string | null): OneNoteImporter {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	subject.importIncompatibleAttachments = false;
	subject.fetchAttachment = async (_progress, name) => download(name);
	return subject;
}

function binaryImporter(resources: Map<string, ArrayBuffer>) {
	const vault = new MemoryVault();
	const downloads: string[] = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;

	Object.assign(subject, {
		app: memoryApp(vault),
		vault,
		host: { abortController: new AbortController() },
		attachmentLocation: { mode: 'vault', path: '' },
		duplicateHandling: DuplicateHandling.Update,
		throttleSpacingMs: 0,
		claimed: new Set<string>(),
		attachmentPaths: new Map<string, string>(),
		attachmentOwners: new Map<string, string>(),
		attachmentPathsChanged: false,
		fetchResource: async (url: string, returnType: string) => {
			const data = resources.get(url);
			if (!data) throw new Error(`No resource at ${url}`);
			assert.equal(returnType, 'file');
			downloads.push(url);
			return data;
		},
	});

	return { downloads, subject, vault };
}

function constructedImporter(vault: MemoryVault, loadData: () => Promise<ImporterData>): OneNoteImporter {
	const app = memoryApp(vault) as unknown as Record<string, unknown>;
	app.secretStorage = {
		getSecret: () => null,
		setSecret: () => {},
		deleteSecret: () => {},
	};

	return new OneNoteImporter(app as never, {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: {
			loadData,
			saveData: async () => {},
			registerAuthCallback: () => {},
		},
		importerId: 'onenote',
		abortController: new AbortController(),
	});
}

test('3gp audio recordings are downloaded and embedded', async () => {
	const downloaded: string[] = [];
	const subject = importer(name => {
		downloaded.push(name);
		return name;
	});

	const page = await subject.getAllAttachments(
		new ImportContext(),
		'<html><body><object data-attachment="Audio Recording.3GP" data="https://example.com/audio" /></body></html>',
		'Notebook/Page.md',
	);

	assert.deepEqual(downloaded, ['Audio Recording.3GP']);
	assert.equal(page.textContent, '![[Audio Recording.3GP]]');
});

test('the audio formats Obsidian plays are imported, not skipped', async () => {
	const downloaded: string[] = [];
	const subject = importer(name => {
		downloaded.push(name);
		return name;
	});

	const names = ['Recording.mp3', 'Recording.m4a', 'Recording.flac', 'Recording.ogg', 'Recording.oga', 'Recording.opus', 'Recording.wav'];
	await subject.getAllAttachments(
		new ImportContext(),
		`<html><body>${names.map(n => `<object data-attachment="${n}" data="https://example.com/audio" />`).join('')}</body></html>`,
		'Notebook/Page.md',
	);

	assert.deepEqual(downloaded, names);
});

test('attachment fallback content stays in order', async () => {
	const subject = importer(name => name);
	const page = await subject.getAllAttachments(
		new ImportContext(),
		'<html><body><p>Before</p><object data-attachment="Document.pdf" data="https://example.com/pdf"><p>First</p><p>Second</p></object><p>After</p></body></html>',
		'Notebook/Page.md',
	);

	const paragraphs = Array.from(page.querySelectorAll('p'), el => el.textContent);
	assert.deepEqual(paragraphs, ['Before', '![[Document.pdf]]', 'First', 'Second', 'After']);
});

test('a failed attachment download does not create an undefined embed', async () => {
	const subject = importer(() => null);
	const page = await subject.getAllAttachments(
		new ImportContext(),
		'<html><body><p>Before</p><object data-attachment="Audio Recording.3gp" data="https://example.com/audio" /><p>After</p></body></html>',
		'Notebook/Page.md',
	);

	assert.doesNotMatch(page.textContent ?? '', /undefined/);
	assert.match(page.textContent ?? '', /Before/);
	assert.match(page.textContent ?? '', /After/);
});

test('an attachment already in the vault is not downloaded again', async () => {
	const downloads: string[] = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	const existing = { path: 'Notebook/Document.pdf' };

	Object.assign(subject, {
		importIncompatibleAttachments: false,
		attachmentLocation: { mode: 'vault', path: '' },
		duplicateHandling: DuplicateHandling.Update,
		throttleSpacingMs: 0,
		attachmentPaths: new Map<string, string>(),
		attachmentOwners: new Map<string, string>(),
		attachmentPathsChanged: false,
		placeAttachment: async () => ({ path: existing.path, reuse: existing }),
		fetchResource: async () => { downloads.push('fetched'); return new ArrayBuffer(0); },
	});

	const progress = new ImportContext();
	const path = await subject.fetchAttachment(progress, 'Document.pdf', 'https://example.com/pdf', 'Notebook/Page.md');

	assert.deepEqual(downloads, [], 'nothing should have been fetched');
	assert.equal(path, existing.path, 'the note should embed the copy already there');
	assert.deepEqual(progress.skipped, ['Document.pdf']);
});

test('a file the user chose not to import is passed over, not reported failed', async () => {
	const subject = importer(name => name);
	const progress = new ImportContext();

	await subject.getAllAttachments(
		progress,
		'<html><body><object data-attachment="budget.xlsx"><p>Fallback</p></object></body></html>',
		'Notebook/Page.md',
	);

	assert.deepEqual(progress.failed, []);
});

test('an attachment with no name is reported, not dropped in silence', async () => {
	const subject = importer(name => name);
	const progress = new ImportContext();

	await subject.getAllAttachments(
		progress,
		'<html><body><object data="https://example.com/thing"><p>Fallback</p></object></body></html>',
		'Notebook/Page.md',
	);

	assert.deepEqual(progress.failed, ['OneNote attachment']);
});

test('an image without a download URL is reported rather than losing the page', async () => {
	const subject = importer(name => name);
	const progress = new ImportContext();

	const page = await subject.getAllAttachments(
		progress,
		'<html><body><p>Before</p><img alt="Missing"><p>After</p></body></html>',
		'Notebook/Page.md',
	);

	assert.deepEqual(progress.failed, ['OneNote image']);
	assert.match(page.textContent ?? '', /Before/);
	assert.match(page.textContent ?? '', /After/);
});

test('an image with no declared type still downloads', async () => {
	const downloaded: string[] = [];
	const subject = importer(name => {
		downloaded.push(name);
		return name;
	});

	await subject.getAllAttachments(
		new ImportContext(),
		'<html><body><img src="x" data-fullres-src="https://example.com/image"></body></html>',
		'Notebook/Page.md',
	);

	assert.equal(downloaded.length, 1);
	assert.match(downloaded[0], /\.png$/);
});

test('images use their resource ids rather than note names or positions', async () => {
	const names: string[] = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;

	Object.assign(subject, {
		importIncompatibleAttachments: false,
		attachmentLocation: { mode: 'vault', path: '' },
		duplicateHandling: DuplicateHandling.CreateCopy,
		throttleSpacingMs: 0,
		attachmentPaths: new Map<string, string>(),
		attachmentOwners: new Map<string, string>(),
		attachmentPathsChanged: false,
		placeAttachment: async (
			name: string,
			_notePath: string,
		) => {
			names.push(name);
			return { path: name, reuse: { path: name } };
		},
	});

	const page = '<html><body>'
		+ '<img data-fullres-src="https://graph.microsoft.com/v1.0/me/onenote/resources/a/$value" data-fullres-src-type="image/png">'
		+ '<img data-fullres-src="https://graph.microsoft.com/v1.0/me/onenote/resources/b/$value" data-fullres-src-type="image/png">'
		+ '</body></html>';

	await subject.getAllAttachments(new ImportContext(), page, 'One/Recipes.md', 1_000);
	await subject.getAllAttachments(new ImportContext(), page, 'Two/Recipes.md', 1_000);

	assert.match(names[0], /^Recipes image [0-9a-f]{16}\.png$/);
	assert.notEqual(names[0], names[1]);
	assert.deepEqual(names.slice(0, 2), names.slice(2), 'the same resources keep their names in another note');
});

test('equal-sized attachments from different resources never share a file', async () => {
	const firstUrl = 'https://graph.microsoft.com/v1.0/me/onenote/resources/first/$value';
	const secondUrl = 'https://graph.microsoft.com/v1.0/me/onenote/resources/second/$value';
	const resources = new Map([
		[firstUrl, Uint8Array.from([1, 2]).buffer],
		[secondUrl, Uint8Array.from([3, 4]).buffer],
	]);
	const { downloads, subject, vault } = binaryImporter(resources);

	const first = await subject.fetchAttachment(
		new ImportContext(), 'Document.pdf', firstUrl, 'First.md', 1_000);
	assert.equal(first, 'Document.pdf');
	subject.indexImportedNotes();
	const second = await subject.fetchAttachment(
		new ImportContext(), 'Document.pdf', secondUrl, 'Second.md', 1_000);

	assert.notEqual(first, second);
	assert.deepEqual(new Uint8Array(vault.contents.get(first!) as ArrayBuffer), Uint8Array.from([1, 2]));
	assert.deepEqual(new Uint8Array(vault.contents.get(second!) as ArrayBuffer), Uint8Array.from([3, 4]));

	subject.indexImportedNotes();
	assert.equal(await subject.fetchAttachment(
		new ImportContext(), 'Document.pdf', secondUrl, 'Second.md', 1_000), second);
	assert.deepEqual(downloads, [firstUrl, secondUrl], 'an unchanged resource is not downloaded again');
});

test('an updated attachment replaces its old bytes even when its size is unchanged', async () => {
	const url = 'https://graph.microsoft.com/v1.0/me/onenote/resources/document/$value';
	const resources = new Map([[url, Uint8Array.from([1, 2]).buffer]]);
	const { subject, vault } = binaryImporter(resources);

	const path = await subject.fetchAttachment(
		new ImportContext(), 'Document.pdf', url, 'Page.md', 1_000);
	resources.set(url, Uint8Array.from([3, 4]).buffer);
	subject.indexImportedNotes();

	assert.equal(await subject.fetchAttachment(
		new ImportContext(), 'Document.pdf', url, 'Page.md', 2_000), path);
	assert.deepEqual(new Uint8Array(vault.contents.get(path!) as ArrayBuffer), Uint8Array.from([3, 4]));
	assert.equal(vault.paths().length, 1);
});

test('a known attachment is reused without a source time or another download', async () => {
	const url = 'https://graph.microsoft.com/v1.0/me/onenote/resources/document/$value';
	const resources = new Map([[url, Uint8Array.from([1, 2]).buffer]]);
	const { downloads, subject, vault } = binaryImporter(resources);

	const path = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', url, 'Page.md');
	subject.indexImportedNotes();

	assert.equal(await subject.fetchAttachment(new ImportContext(), 'Document.pdf', url, 'Page.md'), path);
	assert.deepEqual(downloads, [url]);
	assert.equal(vault.paths().length, 1);
});

test('a legacy attachment is compared once before its resource is remembered', async () => {
	const url = 'https://graph.microsoft.com/v1.0/me/onenote/resources/document/$value';
	const resources = new Map([[url, Uint8Array.from([1, 2]).buffer]]);
	const { downloads, subject, vault } = binaryImporter(resources);

	const path = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', url, 'Page.md');
	const identity = subject as unknown as {
		attachmentPaths: Map<string, string>,
		attachmentOwners: Map<string, string>,
	};
	identity.attachmentPaths.clear();
	identity.attachmentOwners.clear();
	subject.indexImportedNotes();

	assert.equal(await subject.fetchAttachment(new ImportContext(), 'Document.pdf', url, 'Page.md'), path);
	assert.deepEqual(downloads, [url, url]);
	assert.equal(vault.paths().length, 1);
});

test('a different-sized legacy candidate is rejected without reading its bytes', async () => {
	const url = 'https://graph.microsoft.com/v1.0/me/onenote/resources/document/$value';
	const { downloads, subject, vault } = binaryImporter(new Map([
		[url, Uint8Array.from([1, 2, 3]).buffer],
	]));
	await vault.createBinary('Document.pdf', Uint8Array.from([4, 5]).buffer);
	const readBinary = vault.readBinary.bind(vault);
	let reads = 0;
	vault.readBinary = async file => {
		reads++;
		return readBinary(file);
	};

	const path = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', url, 'Page.md');

	assert.equal(path, 'Document 1.pdf');
	assert.equal(reads, 0);
	assert.deepEqual(downloads, [url]);
});

test('attachment identities loaded during construction keep the same map', async () => {
	const vault = new MemoryVault();
	await vault.createBinary('Document.pdf', Uint8Array.from([1]).buffer);
	let release!: (data: ImporterData) => void;
	const loading = new Promise<ImporterData>(resolve => release = resolve);
	let calls = 0;
	const subject = constructedImporter(vault, () => calls++ === 0 ? loading : Promise.resolve(DEFAULT_DATA));
	const before = (subject as unknown as { attachmentPaths: Map<string, string> }).attachmentPaths;

	release({
		...structuredClone(DEFAULT_DATA),
		onenoteAttachments: { 'document\nvault\n\n': 'Document.pdf' },
	});
	await subject.ready;

	const after = (subject as unknown as { attachmentPaths: Map<string, string> }).attachmentPaths;
	assert.equal(after, before);
	assert.equal(after.get('document\nvault\n\n'), 'Document.pdf');
});

test('loading attachment identities drops missing files and conflicting owners', async () => {
	const vault = new MemoryVault();
	await vault.createBinary('Document.pdf', Uint8Array.from([1]).buffer);
	const data: ImporterData = {
		...structuredClone(DEFAULT_DATA),
		onenoteAttachments: {
			'first\nvault\n\n': 'Document.pdf',
			'second\nvault\n\n': 'Document.pdf',
			'missing\nvault\n\n': 'Missing.pdf',
		},
	};
	const subject = constructedImporter(vault, async () => data);

	await subject.ready;

	const identity = subject as unknown as {
		attachmentPaths: Map<string, string>,
		attachmentPathsChanged: boolean,
	};
	assert.deepEqual([...identity.attachmentPaths], [['first\nvault\n\n', 'Document.pdf']]);
	assert.equal(identity.attachmentPathsChanged, true);
});

test('different resources cannot inherit the same mapped path', async () => {
	const firstUrl = 'https://graph.microsoft.com/v1.0/me/onenote/resources/first/$value';
	const secondUrl = 'https://graph.microsoft.com/v1.0/me/onenote/resources/second/$value';
	const resources = new Map([
		[firstUrl, Uint8Array.from([1, 2]).buffer],
		[secondUrl, Uint8Array.from([3, 4]).buffer],
	]);
	const { subject, vault } = binaryImporter(resources);
	const first = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', firstUrl, 'First.md');
	const paths = (subject as unknown as { attachmentPaths: Map<string, string> }).attachmentPaths;
	paths.set('second\nvault\n\n', first!);
	subject.indexImportedNotes();

	const second = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', secondUrl, 'Second.md');

	assert.notEqual(second, first);
	assert.deepEqual(new Uint8Array(vault.contents.get(first!) as ArrayBuffer), Uint8Array.from([1, 2]));
	assert.deepEqual(new Uint8Array(vault.contents.get(second!) as ArrayBuffer), Uint8Array.from([3, 4]));
});

test('byte-identical resources imported separately keep distinct ownership', async () => {
	const firstUrl = 'https://graph.microsoft.com/v1.0/me/onenote/resources/first/$value';
	const secondUrl = 'https://graph.microsoft.com/v1.0/me/onenote/resources/second/$value';
	const bytes = Uint8Array.from([1, 2]).buffer;
	const { downloads, subject, vault } = binaryImporter(new Map([
		[firstUrl, bytes],
		[secondUrl, bytes],
	]));

	const first = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', firstUrl, 'First.md');
	subject.indexImportedNotes();
	const second = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', secondUrl, 'Second.md');

	assert.notEqual(second, first);
	assert.deepEqual(downloads, [firstUrl, secondUrl]);
	assert.equal(vault.paths().length, 2);
});

test('attachment resource paths are saved for the next import', async () => {
	const url = 'https://graph.microsoft.com/v1.0/me/onenote/resources/document/$value';
	const { subject } = binaryImporter(new Map([[url, Uint8Array.from([1, 2]).buffer]]));
	const saved: ImporterData[] = [];
	Object.assign(subject, {
		markdownFiles: new Set<string>(),
		host: {
			abortController: new AbortController(),
			plugin: {
				loadData: async () => structuredClone(DEFAULT_DATA),
				saveData: async (data: ImporterData) => void saved.push(data),
			},
		},
	});

	const path = await subject.fetchAttachment(new ImportContext(), 'Document.pdf', url, 'Page.md');
	await subject.finalizeMarkdownOutput();

	assert.deepEqual(Object.values(saved[0]?.onenoteAttachments ?? {}), [path]);
});

test('an attachment without a download URL is reported and keeps its fallback content', async () => {
	const subject = importer(name => name);
	const progress = new ImportContext();
	const page = await subject.getAllAttachments(
		progress,
		'<html><body><object data-attachment="Document.pdf"><p>Fallback</p></object></body></html>',
		'Notebook/Page.md',
	);

	assert.deepEqual(progress.failed, ['Document.pdf']);
	assert.equal(page.textContent, 'Fallback');
});
