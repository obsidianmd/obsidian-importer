import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PickedFile, PickedFolder } from '../../src/filesystem';
import { FormatImporter } from '../../src/format-importer';
import { HtmlImporter } from '../../src/formats/html';
import { CSVImporter } from '../../src/formats/csv';
import { MarkdownImporter } from '../../src/formats/markdown';
import { SourceFile, SourceFolder } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';

interface SourceInternals {
	readChosen(): Promise<boolean>;
	filesInside(items: (PickedFile | PickedFolder)[]): Promise<PickedFile[]>;
}

class NoChooserImporter extends FormatImporter {
	init(): void {
	}

	async import(): Promise<void> {
	}
}

async function importer<T extends FormatImporter>(
	Importer: new (app: never, host: never) => T,
): Promise<T> {
	const subject = new Importer(memoryApp(new MemoryVault()) as never, {
		sourceEl: null, outputEl: null, optionsEl: null,
	} as never);
	await subject.ready;

	return subject;
}

function names(items: { name: string }[]): string[] {
	return items.map(item => item.name);
}

function notes(delay = 0): SourceFolder {
	return new SourceFolder('Notes', [
		new SourceFile('Index.md'),
		new SourceFile('cover.png'),
		new SourceFolder('Journal', [new SourceFile('Day.markdown')]),
	], delay);
}

test('a folder dropped on an importer that reproduces it stays a folder', async () => {
	const subject = await importer(MarkdownImporter);
	const loose = new SourceFile('Loose.md');
	const stray = new SourceFile('Stray.png');

	subject.takeDropped(
		[notes(), loose, stray],
		[new SourceFile('Index.md'), new SourceFile('cover.png'), loose, stray]);

	assert.deepEqual(names(subject.chosen), ['Notes', 'Loose.md']);
	assert.deepEqual(names(subject.files), ['Index.md', 'Loose.md']);
});

test('a folder dropped on the HTML importer stays available for its page structure', async () => {
	const subject = await importer(HtmlImporter);
	const page = new SourceFile('Page.html');

	subject.takeDropped(
		[new SourceFolder('Site', [page])],
		[page, new SourceFile('style.css')]);

	assert.deepEqual(names(subject.chosen), ['Site']);
	assert.deepEqual(names(subject.files), ['Page.html']);
});

test('a chosen folder is read for the files the importer converts', async () => {
	const subject = await importer(MarkdownImporter);
	subject.chosen = [notes()];

	await (subject as unknown as SourceInternals).readChosen();

	assert.deepEqual(names(subject.files), ['Index.md', 'Day.markdown']);
});

test('reading a folder does not overwrite the pick that replaced it', async () => {
	const subject = await importer(MarkdownImporter);
	const internals = subject as unknown as SourceInternals;

	subject.chosen = [notes(5)];
	const slow = internals.readChosen();

	subject.chosen = [new SourceFile('Picked.md')];
	const replaced = internals.readChosen();

	assert.deepEqual(await Promise.all([slow, replaced]), [false, true]);

	assert.deepEqual(names(subject.files), ['Picked.md']);
});

test('an importer that accepts nothing reads nothing out of a folder', async () => {
	const subject = await importer(NoChooserImporter);
	const internals = subject as unknown as SourceInternals;

	assert.deepEqual(await internals.filesInside([notes()]), []);
	assert.deepEqual(subject.acceptableFiles([new SourceFile('Index.md')]), []);
});

test('a second drop joins the first rather than replacing it', async () => {
	const subject = await importer(MarkdownImporter);
	const one = new SourceFile('One.zip');
	const two = new SourceFile('Two.zip');

	subject.takeDropped([one], [one]);
	subject.takeDropped([two], [two]);

	assert.deepEqual(names(subject.chosen), ['One.zip', 'Two.zip']);
	assert.deepEqual(names(subject.files), ['One.zip', 'Two.zip']);
});

test('dropping the same thing twice leaves one of it', async () => {
	const subject = await importer(MarkdownImporter);
	const one = new SourceFile('One.zip');
	const same = new SourceFile('One.zip');

	subject.takeDropped([one], [one]);
	subject.takeDropped([same], [same]);

	assert.deepEqual(names(subject.chosen), ['One.zip']);
});

test('an importer that takes one file at a time still takes the latest', async () => {
	const subject = await importer(CSVImporter);

	subject.takeDropped([new SourceFile('One.csv')], [new SourceFile('One.csv')]);
	subject.takeDropped([new SourceFile('Two.csv')], [new SourceFile('Two.csv')]);

	assert.deepEqual(names(subject.files), ['Two.csv']);
});
