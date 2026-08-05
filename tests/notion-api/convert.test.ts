/**
 * The Notion API conversion, outside Obsidian.
 *
 * The importer reads a workspace over the API rather than an export, so the
 * fixture is a saved set of responses: a page's blocks, and the children of
 * every block that has them, each shaped as GET /v1/blocks/{id}/children
 * returns it. The client here answers out of that rather than over the network.
 *
 * What is recorded is the markdown the blocks convert to. Attachments and links
 * to other pages need a vault, so the fixture stays clear of them; the parts
 * that do reach a vault are the importer's, not the conversion's.
 *
 * tests/notion-api/live.test.ts checks the fixture's shape against the real
 * API, for when Notion changes what it returns.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertBlocksToMarkdown } from '../../src/formats/notion-api/block-converter';
import type { BlockConversionContext } from '../../src/formats/notion-api/types';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

interface PageFixture {
	pageId: string;
	/** Block id -> the children endpoint's answer for it. */
	blocks: Record<string, { results: unknown[], has_more: boolean, next_cursor: string | null }>;
}

/** Reports nothing and cancels nothing, which is all the conversion asks of it. */
const REPORTER = {
	isCancelled: () => false,
	status: () => {},
	reportNoteSuccess: () => {},
	reportAttachmentSuccess: () => {},
	reportSkipped: () => {},
	reportFailed: (name: string, reason?: unknown) => assert.fail(`${name}: ${reason}`),
};

/** The API, answering out of the fixture. */
function client(page: PageFixture) {
	return {
		blocks: {
			children: {
				list: async ({ block_id }: { block_id: string }) => {
					const children = page.blocks[block_id];
					if (!children) return { object: 'list', results: [], has_more: false, next_cursor: null };
					return children;
				},
			},
			retrieve: async ({ block_id }: { block_id: string }) => {
				for (const { results } of Object.values(page.blocks)) {
					const block = (results as { id: string }[]).find(b => b.id === block_id);
					if (block) return block;
				}
				throw new Error(`no block ${block_id} in the fixture`);
			},
		},
	};
}

function context(page: PageFixture, options: Partial<BlockConversionContext> = {}): BlockConversionContext {
	return {
		ctx: REPORTER,
		client: client(page),
		currentFolderPath: 'Notion',
		currentFilePath: 'Notion/Example page.md',
		downloadExternalAttachments: false,
		listCounters: new Map(),
		blocksCache: new Map(),
		...options,
	} as unknown as BlockConversionContext;
}

// Only the page fixtures: a database fixture lives here too, and is driven by
// database.test.ts rather than as a page's blocks
const pages = fixtures(FIXTURES, '.json').filter(fixture =>
	'pageId' in JSON.parse(nodeFs.readFileSync(fixture.path, 'utf8')));

test('there are pages to convert', () => {
	assert.ok(pages.length > 0, 'expected at least one .json in tests/notion-api');
});

for (const fixture of pages) {
	test(`converts ${fixture.name}`, async () => {
		const page = JSON.parse(nodeFs.readFileSync(fixture.path, 'utf8')) as PageFixture;
		const blocks = page.blocks[page.pageId]?.results;
		assert.ok(blocks?.length, 'the page should have blocks');

		const markdown = await convertBlocksToMarkdown(blocks as never, context(page));

		expectFile(markdown, expectedFor(fixture, `${nodePath.basename(fixture.name, '.json')}.md`), fixture.name);
	});
}

test('writes one line between blocks when asked to', async () => {
	const fixture = pages[0];
	const page = JSON.parse(nodeFs.readFileSync(fixture.path, 'utf8')) as PageFixture;
	const blocks = page.blocks[page.pageId].results;

	const spaced = await convertBlocksToMarkdown(blocks as never, context(page));
	const tight = await convertBlocksToMarkdown(blocks as never, context(page, { singleLineBreaks: true }));

	assert.ok(tight.length < spaced.length, 'single line breaks should produce a shorter note');
	assert.doesNotMatch(tight, /\n\n\n/);
});
