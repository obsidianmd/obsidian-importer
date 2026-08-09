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

function importerOverPages(pages: OnenotePage[], overrides: Partial<OneNoteImporter>): OneNoteImporter {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	Object.assign(subject, {
		selectedSections: [{ id: 'section', title: 'Section' }],
		notebooks: [],
		graphData: { accessToken: 'token' },
		duplicateHandling: DuplicateHandling.CreateCopy,
		host: { plugin: null, abortController: new AbortController() },
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

	const subject = importerOverPages(eightPages, {
		fetchResource: async (url: string) => url.includes('/pages?')
			? { value: eightPages }
			: 'not a multipart document',
	} as Partial<OneNoteImporter>);

	await subject.import(progress);

	assert.deepEqual(failed, eightPages.map(page => page.title));
	assert.deepEqual(skipped, [], 'no page should be abandoned as collateral');
});

test('the total is the whole import from the first note, not one section at a time', async () => {
	// Counting as it went meant the bar filled up on the first section and
	// jumped backwards each time another was opened.
	const sections = [
		{ id: 'a', title: 'A', pages: 3 },
		{ id: 'b', title: 'B', pages: 5 },
		{ id: 'c', title: 'C', pages: 2 },
	];
	const pagesOf = (id: string, n: number): OnenotePage[] => Array.from({ length: n }, (_, i) => ({
		id: `${id}-${i}`, title: `${id} ${i}`, contentUrl: `page-id=${id}-${i}}`,
	}));

	const totals: number[] = [];
	const progress = new ImportContext();
	progress.reportProgress = (_current: number, total: number) => void totals.push(total);

	const subject = importerOverPages([], {
		selectedSections: sections.map(s => ({ id: s.id, title: s.title })),
		fetchResource: async (url: string) => {
			const section = sections.find(s => url.includes(`/sections/${s.id}/pages`));
			return section ? { value: pagesOf(section.id, section.pages) } : 'content';
		},
		processFile: async () => {},
	} as unknown as Partial<OneNoteImporter>);

	await subject.import(progress);

	assert.deepEqual([...new Set(totals)], [10], 'one total throughout, and it is every page');
	assert.equal(totals.length, 11, 'reported once up front and once per page');
});

test('a vault that will not take the write does stop the import', async () => {
	const { progress, failed, skipped } = watchedContext();

	const subject = importerOverPages(eightPages, {
		fetchResource: async (url: string) => url.includes('/pages?') ? { value: eightPages } : 'content',
		processFile: async () => { throw new Error('ENOSPC: no space left on device'); },
	} as Partial<OneNoteImporter>);

	await subject.import(progress);

	assert.equal(failed.length, 6, 'stops once six in a row have failed the same way');
	assert.equal(skipped.length, 2, 'and says what it gave up on');
});
