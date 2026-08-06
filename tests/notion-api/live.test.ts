/**
 * Does Notion still return what the fixture says it does?
 *
 * The recorded conversion in convert.test.ts runs against saved responses,
 * which is what makes it deterministic and offline - and also what makes it go
 * stale without saying so. This asks the real API the same questions the
 * importer asks and checks the answers still have the shape the fixture and the
 * converters assume.
 *
 * It needs a token, so it skips unless one is set. Put it in .env, which is not
 * committed:
 *
 *   NOTION_TOKEN=ntn_...
 *   NOTION_PAGE_ID=...   # optional, otherwise the first page search returns
 *
 * An internal integration token with read access is enough. Nothing here
 * writes anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOTION_VERSION } from '../../src/formats/notion-api/types';
import { env } from '../helpers';


const token = env('NOTION_TOKEN');
const skip = token ? false : 'set NOTION_TOKEN in .env to check the fixture against the live API';

async function api(path: string, body?: unknown): Promise<any> {
	const response = await fetch(`https://api.notion.com/v1${path}`, {
		method: body ? 'POST' : 'GET',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Notion-Version': NOTION_VERSION,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	// Read once: building the message consumes the body, so it cannot be done
	// inside the assertion.
	const text = await response.text();
	assert.equal(response.status, 200, `${path} returned ${response.status}: ${text}`);

	return JSON.parse(text);
}

/** The keys the converter reads, and what it expects to find. */
function assertShape(value: any, shape: Record<string, string>, what: string): void {
	assert.equal(typeof value, 'object', `${what} should be an object`);

	for (const [key, type] of Object.entries(shape)) {
		const actual = Array.isArray(value[key]) ? 'array' : typeof value[key];
		assert.equal(actual, type, `${what}.${key} should be ${type}, got ${actual}`);
	}
}

test('the API still returns the shape the fixture is written to', { skip }, async () => {
	const pageId = env('NOTION_PAGE_ID');

	/**
	 * A page with blocks in it, since a page with none says nothing about the
	 * shape of a block.
	 *
	 * Without NOTION_PAGE_ID this has to go looking, and what search returns
	 * first is whatever the workspace happens to hold - in one with a database
	 * that is a row, which carries its content in properties and has no blocks
	 * at all. So it reads candidates until one has some rather than trusting
	 * the first.
	 */
	async function findPageWithBlocks(): Promise<{ id: string, children: any }> {
		if (pageId) return { id: pageId, children: await api(`/blocks/${pageId}/children?page_size=100`) };

		const found = await api('/search', { filter: { property: 'object', value: 'page' }, page_size: 25 });
		assert.ok(Array.isArray(found.results), 'search should return a list');

		const pages = found.results.filter((r: any) => r.object === 'page');
		assert.ok(pages.length > 0, 'no page to read - share one with the integration, or set NOTION_PAGE_ID');

		for (const page of pages) {
			const children = await api(`/blocks/${page.id}/children?page_size=100`);
			if (children.results?.length > 0) return { id: page.id, children };
		}

		assert.fail(`none of the ${pages.length} pages shared with the integration has any blocks - set NOTION_PAGE_ID to one that does`);
	}

	const { children } = await findPageWithBlocks();

	assertShape(children, { object: 'string', results: 'array', has_more: 'boolean' }, 'children');
	assert.equal(children.object, 'list');
	assert.ok(children.results.length > 0, 'the page should have blocks');

	const types = new Set<string>();

	for (const block of children.results) {
		assertShape(block, {
			object: 'string',
			id: 'string',
			type: 'string',
			has_children: 'boolean',
		}, 'block');

		types.add(block.type);

		// Every block carries its payload under a key named after its type
		assert.ok(block.type in block, `a ${block.type} block should carry a ${block.type} key`);

		// Rich text is where most of the conversion happens
		const richText = block[block.type]?.rich_text;
		if (!Array.isArray(richText)) continue;

		for (const item of richText) {
			assertShape(item, { type: 'string', plain_text: 'string', annotations: 'object' }, `rich text in ${block.type}`);
			assertShape(item.annotations, {
				bold: 'boolean',
				italic: 'boolean',
				strikethrough: 'boolean',
				underline: 'boolean',
				code: 'boolean',
				color: 'string',
			}, 'annotations');
		}
	}

	// Not a failure, but worth seeing: what this page exercises
	console.log(`   block types seen: ${[...types].sort().join(', ')}`);
});

/**
 * Does an attachment URL still answer a request for a byte range?
 *
 * downloadAttachment asks how big an attachment is before fetching it, so that
 * one an earlier import already wrote costs a byte rather than the whole file.
 * That rests on two things Notion does not promise: that its storage refuses a
 * HEAD, and that it honours a Range.
 *
 * Both were measured, and this is what would notice them changing. Nothing
 * breaks if they do - the importer falls back to downloading, as it did before
 * - but the saving quietly stops, which is worth being told about.
 */
test('an attachment URL answers a ranged GET', { skip }, async () => {
	const search = await api('/search', { filter: { property: 'object', value: 'page' }, page_size: 100 });

	let url: string | null = null;
	for (const page of search.results) {
		const { results } = await api(`/blocks/${page.id}/children?page_size=100`);

		for (const block of results) {
			const data = block.image ?? block.file ?? block.pdf ?? block.video;
			if (data?.type === 'file' && data.file?.url) url = data.file.url;
			if (url) break;
		}
		if (url) break;
	}

	if (!url) {
		console.log('   no attachment among the pages this integration can see; nothing to ask');
		return;
	}

	// A presigned URL is signed for one method, so a HEAD is refused. That is
	// why the size is asked for with a range rather than a HEAD.
	const head = await fetch(url, { method: 'HEAD' });
	assert.notEqual(head.status, 200, 'a HEAD is expected to be refused; if it is allowed, it is the cheaper probe');

	const ranged = await fetch(url, { headers: { Range: 'bytes=0-0' } });
	assert.equal(ranged.status, 206, 'the range should be honoured, or every probe costs a whole download');

	const contentRange = ranged.headers.get('content-range');
	assert.match(contentRange ?? '', /^bytes 0-0\/\d+$/, 'the total length is read off the end of this');

	const received = (await ranged.arrayBuffer()).byteLength;
	const total = Number(/\/(\d+)$/.exec(contentRange ?? '')?.[1]);
	assert.equal(received, 1, 'only the byte asked for should arrive');
	assert.ok(total > 1, 'the range should report a length larger than what it sent');

	console.log(`   ${total} bytes learned from ${received}`);
});
