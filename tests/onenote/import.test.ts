import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OnenotePage } from '@microsoft/microsoft-graph-types';

import { findingNotes, OneNoteImporter } from '../../src/formats/onenote';
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
		// Object.create skips the field initialisers the constructor would run.
		sectionPages: new Map(),
		prefetching: Promise.resolve(),
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

test('page lists read ahead of the import are not fetched twice', async () => {
	// The point of reading ahead while the later steps are filled in is that
	// the import then starts on what it already has.
	const listed: string[] = [];
	const pages = [{ id: 'p', title: 'P', contentUrl: 'page-id=p}' }] as OnenotePage[];

	const subject = importerOverPages([], {
		sectionPages: new Map([['section', pages]]),
		fetchResource: async (url: string) => {
			if (url.includes('/pages?')) listed.push(url);
			return url.includes('/pages?') ? { value: pages } : 'content';
		},
		processFile: async () => {},
	} as unknown as Partial<OneNoteImporter>);

	await subject.import(new ImportContext());

	assert.deepEqual(listed, [], 'the cached list should be used as it stands');
});

test('a section missed by the read-ahead is still fetched by the import', async () => {
	const listed: string[] = [];
	const pages = [{ id: 'p', title: 'P', contentUrl: 'page-id=p}' }] as OnenotePage[];

	const subject = importerOverPages([], {
		sectionPages: new Map(),
		fetchResource: async (url: string) => {
			if (url.includes('/pages?')) listed.push(url);
			return url.includes('/pages?') ? { value: pages } : 'content';
		},
		processFile: async () => {},
	} as unknown as Partial<OneNoteImporter>);

	await subject.import(new ImportContext());

	assert.equal(listed.length, 1, 'a read-ahead that failed or never ran must not lose the section');
	// $ arrives percent-encoded, the way every other parameter here already does.
	assert.match(listed[0], /%24top=100/, 'and asks for more than the default 20 a time');
});

test('unticking a section drops it from the read-ahead queue', async () => {
	// Sections are read one at a time, so most of a large selection is still
	// waiting its turn. Changing your mind has to call that work off.
	const listed: string[] = [];
	let releaseFirst: () => void = () => {};
	const firstInFlight = new Promise<void>(resolve => { releaseFirst = resolve; });

	const subject = importerOverPages([], {
		// signedIn is a getter with no setter; graphData is what it reads.
		sectionPages: new Map(),
		selectedSections: [
			{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
		],
		fetchResource: async (url: string) => {
			const id = /sections\/([^/]+)\//.exec(url)?.[1] ?? '';
			listed.push(id);
			if (id === 'a') await firstInFlight;
			return { value: [] };
		},
	} as unknown as Partial<OneNoteImporter>);

	(subject as unknown as { prefetchSelectedPages(): void }).prefetchSelectedPages();

	// While A is still in flight, B and C are unticked.
	subject.selectedSections = [{ id: 'a', title: 'A' }] as OneNoteImporter['selectedSections'];
	releaseFirst();
	await (subject as unknown as { prefetching: Promise<void> }).prefetching;

	assert.deepEqual(listed, ['a'], 'only the section already being read should have been asked for');
});

test('counting says which section it is in and how much it has found', () => {
	// Neither number is worth saying before it means anything: one section is
	// not "1 of 1", and nothing found yet is not "0 notes so far".
	assert.equal(findingNotes('Recipes', 0, 1, 0), 'Finding notes in Recipes');
	assert.equal(findingNotes('Recipes', 0, 7, 0), 'Finding notes in Recipes (section 1 of 7)');
	assert.equal(findingNotes('Recipes', 2, 7, 240), 'Finding notes in Recipes (section 3 of 7, 240 notes so far)');
	assert.equal(findingNotes('Recipes', 1, 1, 1), 'Finding notes in Recipes (1 note so far)');
});

test('the count carries on climbing through sections read ahead', async () => {
	// Reporting only the sections still to be read left the phase silent
	// whenever the read-ahead had already done its job.
	const said: string[] = [];
	const progress = new ImportContext();
	progress.status = (message: string) => void said.push(message);

	const pagesOf = (id: string, n: number): OnenotePage[] => Array.from({ length: n }, (_, i) => ({
		id: `${id}-${i}`, title: `${id} ${i}`, contentUrl: `page-id=${id}-${i}}`,
	}));

	const subject = importerOverPages([], {
		selectedSections: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
		// Both already read ahead, so nothing is fetched during the import.
		sectionPages: new Map([['a', pagesOf('a', 3)], ['b', pagesOf('b', 4)]]),
		fetchResource: async () => 'content',
		processFile: async () => {},
	} as unknown as Partial<OneNoteImporter>);

	await subject.import(progress);

	assert.ok(said.includes('Finding notes in A (section 1 of 2)'), said.join(' | '));
	assert.ok(said.includes('Finding notes in B (section 2 of 2, 3 notes so far)'), said.join(' | '));
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
