import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { provideNodeModules } from '../../src/filesystem';
import { SamsungNotesImporter } from '../../src/formats/samsung-notes';
import { ImportContext } from '../../src/import-context';
import { indexedApp, MemoryVault } from '../shims/vault';
import { SourceZip, zipOf } from '../shims/zip';

provideNodeModules({ path: nodePath });

function fixture(name: string): SourceZip {
	return new SourceZip(name, new Blob([nodeFs.readFileSync(nodePath.join(__dirname, name))]), 'sdocx');
}

async function importFiles(files: SourceZip[], vault = new MemoryVault()): Promise<{ vault: MemoryVault, ctx: ImportContext }> {
	const subject = new SamsungNotesImporter(indexedApp(vault) as never, {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: null,
		importerId: 'samsung-notes',
		abortController: new AbortController(),
	} as never);
	await subject.ready;
	subject.files = files;
	subject.outputLocation = 'Samsung Notes';
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);
	return { vault, ctx };
}

test('imports an image once and embeds it wherever the note places it', async () => {
	const { vault, ctx } = await importFiles([fixture('03-image-placement.sdocx')]);

	assert.deepEqual(vault.paths().sort(), ['Samsung Notes/03-image-placement.md', 'paste_260914_153237_553.png']);
	const note = vault.contents.get('Samsung Notes/03-image-placement.md') as string;
	assert.equal(note.match(/!\[\[paste_260914_153237_553\.png\]\]/g)?.length, 7);
	assert.equal(ctx.notes, 1);
	assert.equal(ctx.attachments, 1);
	const file = vault.getAbstractFileByPath('Samsung Notes/03-image-placement.md') as unknown as { stat: { ctime: number } };
	assert.equal(file.stat.ctime, 1789415847807);
});

test('names a note after its title and reports pages it cannot convert', async () => {
	const { vault, ctx } = await importFiles([
		fixture('01-basic-formatting.sdocx'),
		fixture('04-marker4-highlighter.sdocx'),
	]);

	assert.deepEqual(vault.paths(), ['Samsung Notes/01-basic-test.md', 'Samsung Notes/04-marker4-highlighter.md']);
	assert.deepEqual(ctx.log.map(entry => [entry.outcome, entry.name]), [
		['message', '04-marker4-highlighter: handwriting, drawings, and PDF pages are not imported yet.'],
	]);
});

test('imports the .sdocx files inside a zip and skips anything that is not a note', async () => {
	const bytes = (name: string) => new Uint8Array(nodeFs.readFileSync(nodePath.join(__dirname, name)));
	const { vault, ctx } = await importFiles([await zipOf({
		'Notes/01-basic-formatting.sdocx': bytes('01-basic-formatting.sdocx'),
		'Notes/Not a note.sdocx': (await (await zipOf({ 'readme.txt': 'hello' })).read()),
		'Notes/readme.txt': 'not a note',
	}, 'Samsung Notes.zip')]);

	assert.deepEqual(vault.paths(), ['Samsung Notes/01-basic-test.md']);
	assert.deepEqual(ctx.skipped, ['Samsung Notes.zip/Notes/Not a note.sdocx']);
});
