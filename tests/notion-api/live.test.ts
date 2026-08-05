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
	let pageId = env('NOTION_PAGE_ID');

	if (!pageId) {
		const found = await api('/search', { filter: { property: 'object', value: 'page' }, page_size: 5 });
		assert.ok(Array.isArray(found.results), 'search should return a list');
		pageId = found.results.find((r: any) => r.object === 'page')?.id;
	}

	assert.ok(pageId, 'no page to read - share one with the integration, or set NOTION_PAGE_ID');

	const children = await api(`/blocks/${pageId}/children?page_size=100`);

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
