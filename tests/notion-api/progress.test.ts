/**
 * What "remaining" counts.
 *
 * A Notion import cannot know its size up front: a database says how many rows
 * it holds only once queried, and a page says what child pages it has only
 * once read. The total therefore grows as the import finds out, the way the
 * OneNote importer grows its queue as it reads each section.
 *
 * It used to count what had been ticked in the tree instead, which is neither
 * what gets imported nor all of it: a database counted for nothing while its
 * rows counted for nothing either, and a selected page the import never
 * reached left "remaining" stuck above zero for good.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotionAPIImporter } from '../../src/formats/notion-api';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

class CountingImporter extends NotionAPIImporter {
	/**
	 * A client that answers for any page. `children` maps a page id to the
	 * child pages it holds, so a page can be given children to import.
	 */
	useStubClient(children: Record<string, string[]> = {}): void {
		(this as unknown as { notionClient: unknown }).notionClient = {
			pages: { retrieve: async ({ page_id }: { page_id: string }) => ({ id: page_id, properties: {} }) },
			blocks: {
				children: {
					list: async ({ block_id }: { block_id: string }) => ({
						results: (children[block_id] ?? []).map(id => ({
							object: 'block', id, type: 'child_page', has_children: false,
							child_page: { title: id },
						})),
						has_more: false,
						next_cursor: null,
					}),
				},
			},
		};
	}

	importPage(ctx: ImportContext, pageId: string) {
		return (this as unknown as {
			fetchAndImportPage(params: { ctx: ImportContext, pageId: string, parentPath: string }): Promise<void>;
		}).fetchAndImportPage({ ctx, pageId, parentPath: 'Notion' });
	}

	discover(ctx: ImportContext, pageIds: string[]) {
		(this as unknown as { pagesDiscovered(c: ImportContext, ids: string[]): void }).pagesDiscovered(ctx, pageIds);
	}
}

async function importer() {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');

	const subject = new CountingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.useStubClient();

	return { subject, ctx: new ImportContext() };
}

const remaining = (ctx: ImportContext) => ctx.progressTotal - ctx.progressCurrent;

test('a page nobody ticked in the tree still counts', async () => {
	// Everything a database row or a child page is: imported, and invisible to
	// a count taken from the tree.
	const { subject, ctx } = await importer();

	await subject.importPage(ctx, 'page-1');

	assert.equal(ctx.progressTotal, 1);
	assert.equal(remaining(ctx), 0);
});

test('a database raises the total by the rows it turned out to hold', async () => {
	const { subject, ctx } = await importer();

	subject.discover(ctx, ['row-1', 'row-2', 'row-3']);
	assert.equal(ctx.progressTotal, 3, 'the rows are known before any of them is imported');
	assert.equal(remaining(ctx), 3);

	await subject.importPage(ctx, 'row-1');
	assert.equal(remaining(ctx), 2);

	await subject.importPage(ctx, 'row-2');
	await subject.importPage(ctx, 'row-3');
	assert.equal(remaining(ctx), 0);
});

test('a page reached twice is counted once', async () => {
	// A page can be a child of one page and the target of a mention in
	// another; the second visit returns early and must not count again.
	const { subject, ctx } = await importer();

	await subject.importPage(ctx, 'page-1');
	await subject.importPage(ctx, 'page-1');

	assert.equal(ctx.progressTotal, 1);
	assert.equal(ctx.progressCurrent, 1);
});

test('a page that fails counts too, so remaining still reaches zero', async () => {
	const { subject, ctx } = await importer();
	(subject as unknown as { notionClient: unknown }).notionClient = {
		pages: { retrieve: async () => { throw new Error('Page could not be read'); } },
	};

	await subject.importPage(ctx, 'page-1');

	assert.deepEqual(ctx.failed.length, 1);
	assert.equal(remaining(ctx), 0);
});

/**
 * A total that rises by one and falls by one for every child never settles
 * into a number worth reading. A page's children are counted when its blocks
 * are read, so the number steps up once and then only comes down.
 */
test('a page with children raises the total once, then counts down', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	const subject = new CountingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.useStubClient({ parent: ['child-1', 'child-2', 'child-3'] });

	const seen: number[] = [];
	const ctx = new ImportContext();
	const reportProgress = ctx.reportProgress.bind(ctx);
	ctx.reportProgress = (current, total) => {
		reportProgress(current, total);
		seen.push(total - current);
	};

	await subject.importPage(ctx, 'parent');

	assert.deepEqual(seen, [4, 3, 2, 1, 0], `remaining went ${seen.join(' ')}`);
});
