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
 * The consecutive-failure counter is there to notice something failing the
 * same way for every page — the API going out from under the import, a vault
 * that will not take a write. It stops the run and reports the rest skipped.
 *
 * A page its own content defeated is not that, and six of those in a row used
 * to end a working import. Telling the two apart is the whole point, so both
 * directions are checked.
 */
function importerOverPages(pages: OnenotePage[], overrides: Partial<OneNoteImporter>): OneNoteImporter {
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
	}, overrides);
	return subject;
}

function watchedContext(): { progress: ImportContext, failed: string[], skipped: string[] } {
	const failed: string[] = [];
	const skipped: string[] = [];
	const progress = new ImportContext();
	progress.reportFailed = (name: string) => void failed.push(name);
	progress.reportSkipped = (name: string) => void skipped.push(name);
	return { progress, failed, skipped };
}

const eightPages: OnenotePage[] = Array.from({ length: 8 }, (_, i) => ({
	id: `page-${i}`, title: `Page ${i}`, contentUrl: `page-id=page-${i}}`,
}));

test('pages that will not convert are reported without ending the import', async () => {
	const { progress, failed, skipped } = watchedContext();

	// Not a stub for processFile: the real one is left to reject the content,
	// so what is under test is that it classifies it as the page's own problem.
	const subject = importerOverPages(eightPages, {
		fetchResource: async (url: string) => url.includes('/pages?')
			? { value: eightPages }
			: 'not a multipart document',
	} as Partial<OneNoteImporter>);

	await subject.import(progress);

	assert.deepEqual(failed, eightPages.map(page => page.title));
	assert.deepEqual(skipped, [], 'no page should be abandoned as collateral');
});

test('a vault that will not take the write does stop the import', async () => {
	const { progress, failed, skipped } = watchedContext();

	// A full disk, or a folder that cannot be created, fails the same way for
	// every page after it — which is exactly what the counter is watching for.
	const subject = importerOverPages(eightPages, {
		fetchResource: async (url: string) => url.includes('/pages?') ? { value: eightPages } : 'content',
		processFile: async () => { throw new Error('ENOSPC: no space left on device'); },
	} as Partial<OneNoteImporter>);

	await subject.import(progress);

	assert.equal(failed.length, 6, 'stops once six in a row have failed the same way');
	assert.equal(skipped.length, 2, 'and says what it gave up on');
});
