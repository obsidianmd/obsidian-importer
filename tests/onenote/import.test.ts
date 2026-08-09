import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OnenotePage } from '@microsoft/microsoft-graph-types';

import { OneNoteImporter } from '../../src/formats/onenote';
import { ImportContext } from '../../src/import-context';
import { DuplicateHandling } from '../../src/format-importer';

test('a malformed page is not swallowed before the import can report it', async () => {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	const page = { id: 'page', title: 'Broken page' } as OnenotePage;

	await assert.rejects(subject.processFile(new ImportContext(), 'not multipart', page), /input string is incorrect/);
});

/**
 * The consecutive-failure counter is there to notice the API going out from
 * under an import — it stops the run and reports every page after it skipped.
 * Pages that simply will not convert must not reach it: they are one bad page
 * each, and six of them in a row used to end a working import.
 */
test('pages that will not convert are reported without ending the import', async () => {
	const pages: OnenotePage[] = Array.from({ length: 8 }, (_, i) => ({
		id: `page-${i}`, title: `Page ${i}`, contentUrl: `page-id=page-${i}}`,
	}));

	const failed: string[] = [];
	const skipped: string[] = [];
	const progress = new ImportContext();
	progress.reportFailed = (name: string) => void failed.push(name);
	progress.reportSkipped = (name: string) => void skipped.push(name);

	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	Object.assign(subject, {
		selectedSections: [{ id: 'section', title: 'Section' }],
		notebooks: [],
		graphData: { accessToken: 'token' },
		duplicateHandling: DuplicateHandling.CreateCopy,
		legacyImportedIds: new Set<string>(),
		host: { plugin: null, abortController: new AbortController() },
		readLegacyImportedIds: async () => {},
		getOutputFolder: async () => ({ name: 'OneNote', path: 'OneNote' }),
		insertPagesToSection: () => {},
		fetchResource: async (url: string) => url.includes('/pages?') ? { value: pages } : 'content',
		// Every page converts badly, the way a whole section exported from one
		// source would.
		processFile: async () => { throw new Error('could not convert'); },
	});

	await subject.import(progress);

	assert.deepEqual(failed, pages.map(page => page.title));
	assert.deepEqual(skipped, [], 'no page should be abandoned as collateral');
});
