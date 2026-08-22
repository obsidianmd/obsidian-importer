import '../shims/runtime';

import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';
import { test } from 'node:test';

import { provideNodeModules } from '../../src/filesystem';
import { ImportContext } from '../../src/import-context';
import { NoteTemplateSample } from '../../src/format-importer';
import { AppleNotesImporter } from '../../src/formats/apple-notes';
import { SQLiteTagSpawned } from '../../src/formats/apple-notes/models';
import { MemoryVault, memoryApp } from '../shims/vault';
import { buildStore } from './store';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

class PreviewingAppleNotes extends AppleNotesImporter {
	previewDatabase: SQLiteTagSpawned;

	override async getNotesDatabase(): Promise<SQLiteTagSpawned> {
		return this.previewDatabase;
	}

	async samples(): Promise<NoteTemplateSample[]> {
		return await this.templatePreviewSamples(new ImportContext());
	}

	async render(sample: NoteTemplateSample) {
		return await this.renderTemplatePreview('{{content}}', sample);
	}
}

test('template previews decode the lowercase SQLite data alias', async () => {
	const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-preview-'));
	const store = buildStore(nodePath.join(directory, 'NoteStore.sqlite'), {
		notes: [{
			title: 'Preview note',
			runs: [
				{ text: 'Preview note\n' },
				{ text: 'Selected Apple Notes content.' },
			],
		}],
	});

	try {
		const subject = new PreviewingAppleNotes(
			memoryApp(new MemoryVault()) as never,
			{ sourceEl: null, optionsEl: null } as never,
		);
		subject.selectedFolders = [store.folderPk];
		subject.previewDatabase = {
			get: (...query: Parameters<SQLiteTagSpawned['get']>) => store.database.get(...query),
			all: (strings: TemplateStringsArray, ...params: unknown[]) => store.database.all(
				strings,
				...params.map(param => Array.isArray(param) && param.length === 1 ? param[0] : param),
			),
			close: () => {},
		};

		const samples = await subject.samples();

		assert.equal(samples.length, 1);
		assert.equal(samples[0].title, 'Preview note');
		assert.match(samples[0].content, /Selected Apple Notes content\./);
		assert.doesNotMatch(samples[0].content, /Preview note/);
		assert.equal(samples[0].sourceId, `NOTE-${store.notePks[0]}`);

		subject.omitFirstLine = false;
		const previewsWithFirstLine = await subject.samples();
		assert.match(previewsWithFirstLine[0].content, /Preview note/);

		subject.noteTitleTemplate = '{{ctime | date:"YYYY"}} {{title | upper}}';
		const preview = await subject.render(samples[0]);
		assert.ok(preview.path);
		assert.match(preview.path, /(?:^|\/)\d{4} PREVIEW NOTE\.md$/);
	}
	finally {
		store.close();
		nodeFs.rmSync(directory, { recursive: true, force: true });
	}
});
