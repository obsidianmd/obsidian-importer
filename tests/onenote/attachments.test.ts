import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OneNoteImporter } from '../../src/formats/onenote';
import { ImportContext } from '../../src/import-context';

function importer(download: (name: string) => string | null): OneNoteImporter {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	subject.importIncompatibleAttachments = false;
	subject.fetchAttachment = async (_progress, name) => download(name);
	return subject;
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
