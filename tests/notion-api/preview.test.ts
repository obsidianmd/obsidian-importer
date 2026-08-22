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

function previewPage(id: string, title: string): PageObjectResponse {
	return {
		...page,
		id,
		properties: {
			Name: {
				id: 'title',
				type: 'title',
				title: [{ plain_text: title }],
			},
		},
	} as unknown as PageObjectResponse;
}

function previewNodes(...ids: string[]) {
	return ids.map(id => ({
		id,
		title: id,
		type: 'page',
		parentId: null,
		children: [],
		selected: true,
		disabled: false,
		collapsed: false,
	}));
}

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

test('a cancelled Notion preview read is discarded instead of staying permanently short', async () => {
	const visibleContext = new ImportContext();
	let cancelFirstRead = true;
	let pageReads = 0;
	const subject = Object.create(NotionAPIImporter.prototype) as NotionAPIImporter;
	Object.assign(subject, {
		outputLocation: 'Notion',
		templatePreviewRead: null,
		picker: { nodes: previewNodes('page-1', 'page-2') },
		getSecret: () => 'token',
		initializeNotionClient: () => {},
		notionClient: {
			pages: {
				retrieve: async ({ page_id }: { page_id: string }) => {
					pageReads++;
					return previewPage(page_id, page_id);
				},
			},
			blocks: {
				children: {
					list: async () => {
						if (cancelFirstRead) visibleContext.cancel();
						return { results: [], has_more: false, next_cursor: null };
					},
				},
			},
		},
	});
	const samples = async (ctx: ImportContext) => await (subject as unknown as {
		templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
	}).templatePreviewSamples(ctx);

	assert.equal((await samples(visibleContext)).length, 1);
	assert.equal((subject as unknown as { templatePreviewRead: unknown }).templatePreviewRead, null);

	cancelFirstRead = false;
	assert.equal((await samples(new ImportContext())).length, 2);
	assert.equal(pageReads, 3, 'the retry should read both pages instead of reusing one truncated page');
});

test('cancelling the visible Notion preview does not stop an active prefetch consumer', async () => {
	let releaseFirstPage!: () => void;
	const firstPagePaused = new Promise<void>(resolve => releaseFirstPage = resolve);
	let firstPage = true;
	const subject = Object.create(NotionAPIImporter.prototype) as NotionAPIImporter;
	Object.assign(subject, {
		outputLocation: 'Notion',
		templatePreviewRead: null,
		picker: { nodes: previewNodes('page-1', 'page-2') },
		getSecret: () => 'token',
		initializeNotionClient: () => {},
		notionClient: {
			pages: {
				retrieve: async ({ page_id }: { page_id: string }) => {
					if (firstPage) {
						firstPage = false;
						await firstPagePaused;
					}
					return previewPage(page_id, page_id);
				},
			},
			blocks: {
				children: {
					list: async () => ({ results: [], has_more: false, next_cursor: null }),
				},
			},
		},
	});

	subject.prefetchTemplatePreview();
	const visibleContext = new ImportContext();
	const visible = (subject as unknown as {
		templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
	}).templatePreviewSamples(visibleContext);
	visibleContext.cancel();
	releaseFirstPage();

	assert.equal((await visible).length, 2);
	assert.notEqual(
		(subject as unknown as { templatePreviewRead: unknown }).templatePreviewRead,
		null,
		'the complete shared read should remain reusable',
	);
});

test('Notion previews custom cover and database property names', async () => {
	let databaseReads = 0;
	let blockReads = 0;
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
				query: async () => {
					databaseReads++;
					return { results: [page], has_more: false, next_cursor: null };
				},
			},
			blocks: {
				children: {
					list: async () => {
						blockReads++;
						return { results: [], has_more: false, next_cursor: null };
					},
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

	subject.coverPropertyName = 'banner';
	subject.databasePropertyName = 'database';
	const renamed = await (subject as unknown as {
		templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]>;
	}).templatePreviewSamples(new ImportContext());
	const renamedFrontMatter = parseFrontMatterBlock(renamed[0].content)?.frontMatter;

	assert.equal(databaseReads, 1, 'renaming a property should reuse the fetched page');
	assert.equal(blockReads, 1, 'renaming a property should reuse the fetched blocks');
	assert.equal(renamedFrontMatter?.banner, 'https://example.com/cover.jpg');
	assert.equal(renamedFrontMatter?.database, '[[Projects.base]]');
});

test('Notion ID appears in the rendered preview only when enabled', async () => {
	const subject = Object.create(NotionAPIImporter.prototype) as NotionAPIImporter;
	Object.assign(subject, {
		coverPropertyName: 'cover',
		databasePropertyName: 'base',
		host: { importerId: 'notion-api' },
		idProperty: 'notion-id',
		saveSourceId: false,
	});
	const sample = (subject as unknown as {
		templateSampleFromPage(cached: {
			page: PageObjectResponse;
			blocks: BlockObjectResponse[];
		}): NoteTemplateSample;
	}).templateSampleFromPage({ page, blocks: paragraphBlocks });
	const render = async () => await (subject as unknown as {
		renderTemplatePreview(template: string, sample: NoteTemplateSample): Promise<{ content: string }>;
	}).renderTemplatePreview('{{content}}', sample);

	assert.equal(parseFrontMatterBlock((await render()).content)?.frontMatter['notion-id'], undefined);

	subject.saveSourceId = true;
	assert.equal(parseFrontMatterBlock((await render()).content)?.frontMatter['notion-id'], page.id);
});
