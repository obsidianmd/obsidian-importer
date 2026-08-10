import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import type { OnenotePage } from '@microsoft/microsoft-graph-types';

import { OneNoteImporter } from '../../src/formats/onenote';

interface PagesResponse {
	value: OnenotePage[];
}

const fixture = JSON.parse(
	nodeFs.readFileSync(nodePath.join(__dirname, 'section-pages.json'), 'utf8')
) as PagesResponse;

function sectionOf(total: number): OnenotePage[] {
	return Array.from({ length: total }, (_, i) => ({
		...fixture.value[i % fixture.value.length],
		id: `page-${i}`,
		title: `Page ${i}`,
		order: i,
	}));
}

interface Read {
	pages: OnenotePage[];
	skips: number[];
}

async function readSection(section: OnenotePage[], serve = servingSkip(section)): Promise<Read> {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	const skips: number[] = [];

	Object.assign(subject, {
		graphData: { accessToken: 'token' },
		host: { abortController: new AbortController() },
		lastSuccessfulFetchTime: performance.now(),
	});

	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (url: string) => {
		const asked = new URL(url).searchParams;
		const skip = Number(asked.get('$skip') ?? 0);
		skips.push(skip);

		return new Response(JSON.stringify({ value: serve(skip, Number(asked.get('$top') ?? 20)) }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}) as unknown as typeof fetch;

	try {
		const inner = subject as unknown as {
			fetchSectionPages(sectionId: string): Promise<OnenotePage[]>;
		};
		return { pages: await inner.fetchSectionPages('section'), skips };
	}
	finally {
		globalThis.fetch = realFetch;
	}
}

const servingSkip = (section: OnenotePage[]) =>
	(skip: number, top: number) => section.slice(skip, skip + top);

test('a section past the first 100 pages is read to its end', async () => {
	const { pages, skips } = await readSection(sectionOf(250));

	assert.deepEqual(skips, [0, 100, 200], 'each request should ask for the ones after the last');
	assert.equal(pages.length, 250);
	assert.deepEqual(pages.map(page => page.title), sectionOf(250).map(page => page.title),
		'in the order the section keeps them in');
});

test('a section that ends on the boundary is asked once more, and stops', async () => {
	const { pages, skips } = await readSection(sectionOf(200));

	assert.deepEqual(skips, [0, 100, 200], 'a full batch could always be followed by another');
	assert.equal(pages.length, 200);
});

test('a section inside one request is only asked for once', async () => {
	const { pages, skips } = await readSection(sectionOf(12));

	assert.deepEqual(skips, [0]);
	assert.equal(pages.length, 12);
});

test('a section that ignores $skip is not read forever', async () => {
	const section = sectionOf(250);
	const { pages, skips } = await readSection(section, (_skip, top) => section.slice(0, top));

	assert.deepEqual(skips, [0, 100], 'the repeat is what says the paging went unanswered');
	assert.equal(pages.length, 100, 'and what it did read is kept, once each');
});
