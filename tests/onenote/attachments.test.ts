import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OneNoteImporter } from '../../src/formats/onenote';
import { ImportContext } from '../../src/import-context';
import { DuplicateHandling } from '../../src/format-importer';

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

test('an attachment already in the vault is not downloaded again', async () => {
	const downloads: string[] = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	const existing = { path: 'Notebook/Document.pdf' };

	Object.assign(subject, {
		importIncompatibleAttachments: false,
		duplicateHandling: DuplicateHandling.Update,
		throttleSpacingMs: 0,
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

test('an image is named after its note, so a later import can recognise it', async () => {
	const downloaded: string[] = [];
	const subject = importer(name => {
		downloaded.push(name);
		return name;
	});

	const page = '<html><body>'
		+ '<img data-fullres-src="https://example.com/a" data-fullres-src-type="image/png">'
		+ '<img data-fullres-src="https://example.com/b" data-fullres-src-type="image/jpeg">'
		+ '</body></html>';

	await subject.getAllAttachments(new ImportContext(), page, 'Notebook/Recipes.md');
	await subject.getAllAttachments(new ImportContext(), page, 'Notebook/Recipes.md');

	assert.deepEqual(downloaded, [
		'Recipes image 1.png', 'Recipes image 2.jpeg',
		'Recipes image 1.png', 'Recipes image 2.jpeg',
	], 'the same image asks for the same name every import');
});

test('the size is asked for before the attachment is fetched', async () => {
	const asked: Array<[string, string]> = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;

	Object.assign(subject, {
		duplicateHandling: DuplicateHandling.Update,
		throttleSpacingMs: 0,
		sizeProbeAnswered: true,
		placeAttachment: async (
			_name: string,
			_notePath: string,
			recognise: (existing: { stat: { size: number } }) => Promise<string>,
		) => {
			const verdict = await recognise({ stat: { size: 4096 } });
			return verdict === 'same'
				? { path: 'Notebook/Document.pdf', reuse: { path: 'Notebook/Document.pdf' } }
				: { path: 'Notebook/Document 1.pdf', reuse: null };
		},
		fetchResource: async (url: string, returnType: string) => {
			asked.push([returnType, url]);
			return returnType === 'range' ? 4096 : new ArrayBuffer(0);
		},
	});

	const progress = new ImportContext();
	const path = await subject.fetchAttachment(progress, 'Document.pdf', 'https://example.com/pdf', 'Notebook/Page.md');

	assert.deepEqual(asked, [['range', 'https://example.com/pdf']], 'the bytes were never fetched');
	assert.equal(path, 'Notebook/Document.pdf');
	assert.deepEqual(progress.skipped, ['Document.pdf']);
});

test('a size that does not match is downloaded rather than taken for this one', async () => {
	const asked: string[] = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;

	Object.assign(subject, {
		duplicateHandling: DuplicateHandling.Update,
		throttleSpacingMs: 0,
		sizeProbeAnswered: true,
		placeAttachment: async (
			_name: string,
			_notePath: string,
			recognise: (existing: { stat: { size: number } }) => Promise<string>,
		) => {
			// A file of another size is sitting on the name this one wants.
			await recognise({ stat: { size: 11 } });
			return { path: 'Notebook/Document 1.pdf', reuse: null };
		},
		fetchResource: async (url: string, returnType: string) => {
			asked.push(returnType);
			return returnType === 'range' ? 4096 : new ArrayBuffer(4096);
		},
		writeAttachment: async () => {},
	});

	const path = await subject.fetchAttachment(
		new ImportContext(), 'Document.pdf', 'https://example.com/pdf', 'Notebook/Page.md');

	assert.deepEqual(asked, ['range', 'file']);
	assert.equal(path, 'Notebook/Document 1.pdf', 'the other file is left as it stands');
});

test('a service that ignores the range is only asked the once', async () => {
	const asked: string[] = [];
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;

	Object.assign(subject, {
		duplicateHandling: DuplicateHandling.Update,
		throttleSpacingMs: 0,
		sizeProbeAnswered: true,
		placeAttachment: async (
			_name: string,
			_notePath: string,
			recognise: (existing: { stat: { size: number } }) => Promise<string>,
		) => {
			await recognise({ stat: { size: 11 } });
			return { path: 'Notebook/Document.pdf', reuse: null };
		},
		fetchResource: async (_url: string, returnType: string) => {
			asked.push(returnType);
			// null is what a response that sent the whole file reports.
			return returnType === 'range' ? null : new ArrayBuffer(11);
		},
		writeAttachment: async () => {},
	});

	const progress = new ImportContext();
	await subject.fetchAttachment(progress, 'A.pdf', 'https://example.com/a', 'Notebook/Page.md');
	await subject.fetchAttachment(progress, 'B.pdf', 'https://example.com/b', 'Notebook/Page.md');

	assert.deepEqual(asked, ['range', 'file', 'file'], 'the probe stops after the first refusal');
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
