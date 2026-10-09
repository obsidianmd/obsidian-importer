import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { SupernotesImporter, uploadFileName } from '../../src/formats/supernotes';
import { ImportContext } from '../../src/import-context';
import { SourceFile } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';
import { answerRequests } from '../shims/obsidian';

const EXPORT = nodeFs.readFileSync(nodePath.join(__dirname, 'cards.json'), 'utf8');

const TOP_LEVEL = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000011'];

async function importer(vault: MemoryVault, outputLocation: string, mergeInto: string[] = []) {
	const subject = new SupernotesImporter(memoryApp(vault), { sourceEl: null, outputEl: null, optionsEl: null } as never);
	await subject.ready;
	subject.outputLocation = outputLocation;
	subject.mergeInto = new Set(mergeInto);
	subject.indexImportedNotes();
	return subject;
}

/** Runs a body with every upload request answered by a few bytes, counting them. */
async function answeringUploads<T>(body: () => Promise<T>): Promise<{ result: T, requested: string[] }> {
	const requested: string[] = [];
	const previous = answerRequests(request => {
		// The importer passes a bare URL, as Obsidian's requestUrl allows.
		const url = typeof request === 'string' ? request : request.url;
		requested.push(url);
		// An upload named without an extension answers with PNG bytes.
		const bytes = url.endsWith('screenshot_0')
			? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			: new TextEncoder().encode('bytes');
		return { status: 200, headers: {}, arrayBuffer: bytes.buffer as ArrayBuffer };
	});
	try {
		return { result: await body(), requested };
	}
	finally {
		answerRequests(previous);
	}
}

test('cards are written as notes in folders that mirror the hierarchy', async () => {
	const vault = new MemoryVault();
	const subject = await importer(vault, 'Supernotes');
	subject.files = [new SourceFile('cards.json', EXPORT)];

	const ctx = new ImportContext();
	await answeringUploads(() => subject.import(ctx));

	const notes = vault.paths().filter(path => path.endsWith('.md')).sort();
	assert.deepEqual(notes, [
		'Supernotes/Loop B/Loop A.md',
		'Supernotes/Loop B/Loop B.md',
		'Supernotes/Manager 11 10-9-26.md',
		'Supernotes/Projects/Alpha/Alpha notes/Alpha notes.md',
		'Supernotes/Projects/Alpha/Alpha notes/Deep detail.md',
		'Supernotes/Projects/Alpha/Alpha.md',
		'Supernotes/Projects/Beta.md',
		'Supernotes/Projects/Projects.md',
		'Supernotes/Projects/Shared.md',
		'Supernotes/Reading/Book one.md',
		'Supernotes/Reading/Reading.md',
		'Supernotes/Reading/book one 1.md',
	]);

	const alpha = vault.contents.get('Supernotes/Projects/Alpha/Alpha.md');
	assert.ok(typeof alpha === 'string');
	assert.match(alpha, /^supernotes-id: aaaaaaaa-0000-4000-8000-000000000002$/m);
	assert.match(alpha, /See \[\[Beta\]\] and \[\[Alpha notes\]\]\./);
	assert.match(alpha, /\[\[Old card name-with slash\|notes\]\]/);
	assert.match(alpha, /\[gone\]\(\^aaaaaaaa-0000-4000-8000-00000000eeee\)/, 'an unknown card is left as written');
	assert.match(alpha, /Not a link: \[Beta\]\(\^aaaaaaaa/, 'a link inside a code block is left alone');

	const shared = vault.contents.get('Supernotes/Projects/Shared.md') as string;
	assert.match(shared, /\*\*Also in:\*\* \[\[Reading\]\]/);

	const beta = vault.contents.get('Supernotes/Projects/Beta.md') as string;
	assert.match(beta, /^tags:\n {2}- legacy\n {2}- to-do$/m);
	assert.match(beta, /!\[\[.*Clean Shot 2026\.png\]\]/, 'the upload is embedded from the vault');
	assert.match(beta, /\[\[.*spec\.pdf\|spec\]\]/, 'a linked upload keeps its text');
	assert.match(beta, /!\[\[assets\/.*--screenshot_0\.png\]\]/, 'an upload named without an extension is given one from its bytes');
	assert.match(beta, /!\[Cover\]\(https:\/\/example\.com\/cover\.jpg\)/, 'other images keep their URL');

	assert.deepEqual(vault.paths().filter(path => !path.endsWith('.md')).sort(), [
		'assets/0f0f0f0f-1111-4222-8333-444444444444--Clean Shot 2026.png',
		'assets/0f0f0f0f-1111-4222-8333-555555555555--spec.pdf',
		'assets/0f0f0f0f-1111-4222-8333-666666666666--screenshot_0.png',
	], 'uploads go to an assets folder by default');
	assert.equal(ctx.notes, 12);
	assert.equal(ctx.attachments, 3);
	assert.deepEqual(ctx.skipped, ['cards.json'], 'the entry that is not a card is reported');
});

test('merging folds every descendant into its top-level card', async () => {
	const vault = new MemoryVault();
	const subject = await importer(vault, '', TOP_LEVEL);
	subject.files = [new SourceFile('cards.json', EXPORT)];

	await answeringUploads(() => subject.import(new ImportContext()));

	const notes = vault.paths().filter(path => path.endsWith('.md')).sort();
	assert.deepEqual(notes, ['Loop B.md', 'Manager 11 10-9-26.md', 'Projects.md', 'Reading.md']);

	const projects = vault.contents.get('Projects.md') as string;
	assert.match(projects, /^## Alpha$/m);
	assert.match(projects, /^### Alpha notes$/m);
	assert.match(projects, /^#### Status$/m, 'a folded card\'s headings nest under its own');
	assert.match(projects, /^#### Deep detail$/m);
	assert.match(projects, /^###### Already deep$/m, 'demotion stops at six');
	assert.match(projects, /\[\[Projects#Alpha notes\|Alpha notes\]\]/);
	assert.match(projects, /^tags:\n {2}- Main-Quest\n {2}- legacy\n {2}- to-do$/m);
});

test('an upload already in the vault is reused rather than fetched again', async () => {
	const vault = new MemoryVault();
	const first = await importer(vault, 'Supernotes');
	first.files = [new SourceFile('cards.json', EXPORT)];
	const firstRun = await answeringUploads(() => first.import(new ImportContext()));
	assert.equal(firstRun.requested.length, 3);

	const again = await importer(vault, 'Supernotes');
	again.files = [new SourceFile('cards.json', EXPORT)];
	const secondRun = await answeringUploads(() => again.import(new ImportContext()));

	// An upload named without an extension has to be fetched before its vault name is known.
	assert.deepEqual(secondRun.requested, ['https://supernotes-resources.s3.amazonaws.com/image-uploads/0f0f0f0f-1111-4222-8333-666666666666--screenshot_0'],
		'an upload whose name carries its extension is not downloaded twice');
	assert.deepEqual(vault.paths().filter(path => path.endsWith('.png')), ['assets/0f0f0f0f-1111-4222-8333-444444444444--Clean Shot 2026.png', 'assets/0f0f0f0f-1111-4222-8333-666666666666--screenshot_0.png']);
});

test('a file that is not an export fails on its own, without stopping the run', async () => {
	const vault = new MemoryVault();
	const subject = await importer(vault, 'Supernotes');
	subject.files = [new SourceFile('other.json', '[1, 2, 3]'), new SourceFile('cards.json', EXPORT)];

	const ctx = new ImportContext();
	await answeringUploads(() => subject.import(ctx));

	assert.deepEqual(ctx.failed, ['other.json']);
	assert.equal(ctx.notes, 12);
});

test('an upload name is decoded from its URL', () => {
	assert.equal(uploadFileName('https://supernotes-resources.s3.amazonaws.com/image-uploads/abc--Clean%2520Shot%25202026.png'), 'abc--Clean Shot 2026.png');
	assert.equal(uploadFileName('https://supernotes-resources.s3.amazonaws.com/image-uploads/abc--plain.png'), 'abc--plain.png');
	assert.equal(uploadFileName('https://supernotes-resources.s3.amazonaws.com/'), 'upload');
});
