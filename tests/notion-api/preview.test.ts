import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BlockObjectResponse, PageObjectResponse } from '@notionhq/client';

import { NotionAPIImporter, notionBlocksPreview } from '../../src/formats/notion-api';
import { ImportContext } from '../../src/import-context';
import type { NoteTemplateSample } from '../../src/format-importer';
import { parseFrontMatterBlock } from '../../src/util';

const page = {
	object: 'page',
	id: 'page-1',
	created_time: '2026-01-01T00:00:00.000Z',
	last_edited_time: '2026-01-02T00:00:00.000Z',
	cover: { type: 'external', external: { url: 'https://example.com/cover.jpg' } },
	properties: {
		Name: {
			id: 'title',
			type: 'title',
			title: [{ plain_text: 'A real page' }],
		},
	},
} as unknown as PageObjectResponse;

const paragraphBlocks = [
	{
		id: 'block-1',
		type: 'paragraph',
		paragraph: { rich_text: [{ type: 'text', plain_text: 'First paragraph' }] },
	},
	{
		id: 'block-2',
		type: 'paragraph',
		paragraph: { rich_text: [{ type: 'text', plain_text: 'Second paragraph' }] },
	},
] as unknown as BlockObjectResponse[];

test('Notion API previews reflect the line-break mode', () => {
	assert.equal(notionBlocksPreview(paragraphBlocks), 'First paragraph\n\nSecond paragraph');
	assert.equal(notionBlocksPreview(paragraphBlocks, true), 'First paragraph\nSecond paragraph');
});

test('Notion starts selected page samples early and reuses them in the preview', async () => {
	let pageReads = 0;
	let blockReads = 0;
	const subject = Object.create(NotionAPIImporter.prototype) as NotionAPIImporter;
	Object.assign(subject, {
		outputLocation: 'Before',
		templatePreviewRead: null,
		picker: {
			nodes: [{
				id: page.id,
				title: 'A real page',
				type: 'page',
				parentId: null,
				children: [],
				selected: true,
				disabled: false,
				collapsed: false,
			}],
		},
		getSecret: () => 'token',
		initializeNotionClient: () => {},
		notionClient: {
			pages: {
				retrieve: async () => {
					pageReads++;
					return page;
				},
			},
			blocks: {
				children: {
					list: async () => {
						blockReads++;
						return { results: paragraphBlocks, has_more: false, next_cursor: null };
					},
				},
			},
		},
	});

	subject.prefetchTemplatePreview();
	await (subject as unknown as {
		templatePreviewRead: { request: Promise<NoteTemplateSample[]> };
	}).templatePreviewRead.request;

	subject.outputLocation = 'After';
	const samples = await (subject as unknown as {
		templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
	}).templatePreviewSamples(new ImportContext());

	assert.equal(pageReads, 1);
	assert.equal(blockReads, 1);
	assert.equal(samples[0].title, 'A real page');
	assert.equal(samples[0].path, 'After/A real page.md');
	assert.match(samples[0].content, /First paragraph\n\nSecond paragraph/);

	subject.singleLineBreaks = true;
	const tightSamples = await (subject as unknown as {
		templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
	}).templatePreviewSamples(new ImportContext());
	assert.equal(blockReads, 1, 'changing line breaks should reuse the prefetched blocks');
	assert.match(tightSamples[0].content, /First paragraph\nSecond paragraph/);
	assert.doesNotMatch(tightSamples[0].content, /First paragraph\n\nSecond paragraph/);
});

test('Notion previews custom cover and database property names', async () => {
	const subject = Object.create(NotionAPIImporter.prototype) as NotionAPIImporter;
	Object.assign(subject, {
		outputLocation: 'Notion',
		coverPropertyName: 'hero',
		databasePropertyName: 'collection',
		templatePreviewRead: null,
		picker: {
			nodes: [{
				id: 'database-1',
				title: 'Projects',
				type: 'database',
				parentId: null,
				children: [],
				selected: true,
				disabled: false,
				collapsed: false,
			}],
		},
		getSecret: () => 'token',
		initializeNotionClient: () => {},
		notionClient: {
			dataSources: {
				query: async () => ({ results: [page], has_more: false, next_cursor: null }),
			},
			blocks: {
				children: {
					list: async () => ({ results: [], has_more: false, next_cursor: null }),
				},
			},
		},
	});

	const samples = await (subject as unknown as {
		templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
	}).templatePreviewSamples(new ImportContext());
	const frontMatter = parseFrontMatterBlock(samples[0].content)?.frontMatter;

	assert.equal(frontMatter?.hero, 'https://example.com/cover.jpg');
	assert.equal(frontMatter?.collection, '[[Projects.base]]');
	assert.equal(frontMatter?.cover, undefined);
	assert.equal(frontMatter?.base, undefined);
});
