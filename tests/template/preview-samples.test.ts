import '../shims/dom';
import '../shims/runtime';

import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';
import { test } from 'node:test';

import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../../src/format-importer';
import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { Bear2bkImporter } from '../../src/formats/bear-bear2bk';
import { EvernoteEnexImporter } from '../../src/formats/evernote-enex';
import { NotionImporter } from '../../src/formats/notion';
import { OneNoteFileImporter } from '../../src/formats/onenote-file';
import { RoamJSONImporter } from '../../src/formats/roam-json';
import { TextbundleImporter } from '../../src/formats/textbundle';
import { ImportContext } from '../../src/import-context';
import { memoryApp, MemoryVault } from '../shims/vault';

provideNodeModules({
	nodeCrypto,
	fs: nodeFs as never,
	os: nodeOs,
	path: nodePath,
	zlib: nodeZlib,
});

type ImporterConstructor = new (...args: ConstructorParameters<typeof FormatImporter>) => FormatImporter;

interface Previewable {
	ready: Promise<void>;
	outputLocation: string;
	files: NodePickedFile[];
	templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
}

async function previews(
	Importer: ImporterConstructor,
	id: string,
	fixture: string,
): Promise<{ samples: NoteTemplateSample[], vault: MemoryVault }> {
	const vault = new MemoryVault();
	const subject = new Importer(memoryApp(vault), {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: null,
		importerId: id,
		abortController: new AbortController(),
	} as never) as unknown as Previewable;
	await subject.ready;
	subject.outputLocation = 'Import';
	subject.files = [new NodePickedFile(fixture)];
	return { samples: await subject.templatePreviewSamples(new ImportContext()), vault };
}

function fixture(...parts: string[]): string {
	return nodePath.join(__dirname, '..', ...parts);
}

const cases: Array<{
	name: string;
	Importer: ImporterConstructor;
	id: string;
	fixture: string;
}> = [
	{
		name: 'Bear',
		Importer: Bear2bkImporter,
		id: 'bear',
		fixture: fixture('bear', 'backup.bear2bk'),
	},
	{
		name: 'Evernote',
		Importer: EvernoteEnexImporter,
		id: 'evernote',
		fixture: fixture('evernote', 'code-block-language.enex'),
	},
	{
		name: 'Notion export',
		Importer: NotionImporter,
		id: 'notion',
		fixture: fixture('notion', 'notion-testspace.zip'),
	},
	{
		name: 'OneNote file',
		Importer: OneNoteFileImporter,
		id: 'onenote-file',
		fixture: fixture('onenote-file', 'fixtures', 'testOneNote2016.one'),
	},
	{
		name: 'Roam',
		Importer: RoamJSONImporter,
		id: 'roam-json',
		fixture: fixture('roam', 'small-test-graph.json'),
	},
	{
		name: 'Textbundle',
		Importer: TextbundleImporter,
		id: 'textbundle',
		fixture: fixture('textbundle', 'example.textpack'),
	},
];

for (const entry of cases) {
	test(`${entry.name} previews real selected notes without writing`, async () => {
		const { samples, vault } = await previews(entry.Importer, entry.id, entry.fixture);
		assert.ok(samples.length > 0, 'expected at least one selected note');
		assert.ok(samples.length <= TEMPLATE_PREVIEW_LIMIT);
		assert.ok(samples.every(sample => sample.title !== 'Imported note'));
		assert.ok(samples.some(sample => sample.content.trim().length > 0));
		assert.deepEqual(vault.paths(), []);
	});
}
