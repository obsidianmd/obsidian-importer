import '../shims/dom';
import '../shims/runtime';

import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { TFile } from 'obsidian';

import { provideNodeModules, NodePickedFile } from '../../src/filesystem';
import { DuplicateHandling, NoteTemplateSetup } from '../../src/format-importer';
import { CSVImporter } from '../../src/formats/csv';
import { ImportContext } from '../../src/import-context';
import { memoryApp, MemoryVault } from '../shims/vault';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

class ReimportingCSV extends CSVImporter {
	protected override async showNoteTemplateConfiguration(
		_container: HTMLElement,
		_buttonsEl: HTMLElement,
		setup: NoteTemplateSetup,
	): Promise<boolean> {
		this.inlineTemplate ??= setup.defaultTemplate ?? '{{content}}';
		return true;
	}
}

async function importing(subject: ReimportingCSV, source: NodePickedFile): Promise<ImportContext> {
	subject.files = [source];
	const ctx = new ImportContext();
	assert.equal(await subject.showTemplateConfiguration(ctx, createDiv(), createDiv()), true);
	subject.indexImportedNotes();
	await subject.import(ctx);
	return ctx;
}

test('CSV update uses the source file time to protect newer local edits', async t => {
	const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-csv-reimport-'));
	t.after(() => nodeFs.rmSync(directory, { recursive: true, force: true }));
	const sourcePath = nodePath.join(directory, 'records.csv');
	const sourceTime = 1_700_000_000_000;
	nodeFs.writeFileSync(sourcePath, 'Name,Value\nAlpha,first\n');
	nodeFs.utimesSync(sourcePath, new Date(sourceTime), new Date(sourceTime));

	const vault = new MemoryVault();
	const subject = new ReimportingCSV(memoryApp(vault), {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: null,
		importerId: 'csv',
		abortController: new AbortController(),
	} as never);
	await subject.ready;
	subject.outputLocation = 'CSV import';
	subject.duplicateHandling = DuplicateHandling.Update;
	const source = new NodePickedFile(sourcePath);

	await importing(subject, source);
	const note = vault.getAbstractFileByPath('CSV import/Alpha.md');
	assert.ok(note instanceof TFile);
	assert.equal(note.stat.mtime, sourceTime);
	assert.match(String(vault.contents.get(note.path)), /Value: "first"/u);

	const unchanged = await importing(subject, source);
	assert.deepEqual(unchanged.skipped, ['Alpha']);

	const localTime = sourceTime + 10_000;
	await vault.modify(note, 'edited locally\n', { mtime: localTime });
	const preserved = await importing(subject, source);
	assert.deepEqual(preserved.skipped, ['Alpha']);
	assert.equal(vault.contents.get(note.path), 'edited locally\n');

	const updatedSourceTime = localTime + 10_000;
	nodeFs.writeFileSync(sourcePath, 'Name,Value\nAlpha,second\n');
	nodeFs.utimesSync(sourcePath, new Date(updatedSourceTime), new Date(updatedSourceTime));
	const updated = await importing(subject, source);
	assert.deepEqual(updated.skipped, []);
	assert.match(String(vault.contents.get(note.path)), /Value: "second"/u);
	assert.equal(note.stat.mtime, updatedSourceTime);
});
