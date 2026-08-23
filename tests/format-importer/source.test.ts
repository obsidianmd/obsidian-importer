import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PickedFile, PickedFolder } from '../../src/filesystem';
import { FormatImporter } from '../../src/format-importer';
import { HtmlImporter } from '../../src/formats/html';
import { CSVImporter } from '../../src/formats/csv';
import { FilesImporter } from '../../src/formats/files';
import { MarkdownImporter } from '../../src/formats/markdown';
import { SourceFile, SourceFolder } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';

interface SourceInternals {
	readChosen(): Promise<boolean>;
	setChosen(chosen: (PickedFile | PickedFolder)[]): Promise<boolean>;
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

test('note importers configure a template without becoming dialog-only', async () => {
	const generic = await importer(NoChooserImporter);
	const csv = await importer(CSVImporter);
	const files = await importer(FilesImporter);

	assert.equal(generic.configures, true);
	assert.equal(generic.requiresImporterConfiguration, false);
	assert.equal(csv.configures, true);
	assert.equal(csv.requiresImporterConfiguration, true);
	assert.equal(files.configures, false);
	assert.equal(files.requiresImporterConfiguration, false);
});

test('a folder dropped on the HTML importer stays available for its page structure', async () => {
	const subject = await importer(HtmlImporter);
	const page = new SourceFile('Page.html');
	const style = new SourceFile('style.css');
	const dropped = [new SourceFolder('Site', [page])];
	const files = [page, style];

	assert.equal(subject.wouldTake(dropped, files), 1);
	assert.equal(subject.takesWholeDrop(dropped, files), true);

	subject.takeDropped(dropped, files);

	assert.deepEqual(names(subject.chosen), ['Site']);
	assert.deepEqual(names(subject.files), ['Page.html']);
});

test('the HTML importer accepts a zip as a complete source', async () => {
	const subject = await importer(HtmlImporter);
	const zip = new SourceFile('Site.zip');

	assert.ok(HtmlImporter.extensions.includes('zip'));
	assert.equal(subject.wouldTake([zip], [zip]), 1);
	assert.equal(subject.takesWholeDrop([zip], [zip]), true);

	subject.takeDropped([zip], [zip]);
	assert.deepEqual(names(subject.chosen), ['Site.zip']);
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

test('a failed selection restores the selection it replaced', async () => {
	const subject = await importer(MarkdownImporter);
	const internals = subject as unknown as SourceInternals;
	const previous = new SourceFile('Previous.md');
	const broken = new SourceFolder('Broken', []);
	internals.filesInside = async () => { throw new Error('cannot read'); };
	subject.chosen = subject.files = [previous];

	await assert.rejects(internals.setChosen([broken]), /cannot read/);

	assert.deepEqual(names(subject.chosen), ['Previous.md']);
	assert.deepEqual(names(subject.files), ['Previous.md']);
});

test('a superseded selection cannot roll back the selection that replaced it', async () => {
	const subject = await importer(MarkdownImporter);
	const internals = subject as unknown as SourceInternals;
	let release!: () => void;
	const waiting = new Promise<void>(resolve => {
		release = resolve;
	});
	const broken = new SourceFolder('Slow and broken', []);
	const filesInside = internals.filesInside.bind(subject);
	internals.filesInside = async items => {
		if (items[0] === broken) {
			await waiting;
			throw new Error('cannot read');
		}
		return filesInside(items);
	};
	const slow = internals.setChosen([broken]);
	const replacement = new SourceFile('Replacement.md');

	assert.equal(await internals.setChosen([replacement]), true);
	release();
	await assert.rejects(slow, /cannot read/);

	assert.deepEqual(names(subject.chosen), ['Replacement.md']);
	assert.deepEqual(names(subject.files), ['Replacement.md']);
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
