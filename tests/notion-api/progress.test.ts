import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotionAPIImporter } from '../../src/formats/notion-api';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

class CountingImporter extends NotionAPIImporter {
	useStubClient(children: Record<string, string[]> = {}): void {
		this.notionClient = {
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
		} as never;
	}

	useFailingClient(): void {
		this.notionClient = {
			pages: { retrieve: async () => { throw new Error('Page could not be read'); } },
		} as never;
	}

	importPage(ctx: ImportContext, pageId: string) {
		return this.fetchAndImportPage({ ctx, pageId, parentPath: 'Notion' });
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
	const { subject, ctx } = await importer();

	await subject.importPage(ctx, 'page-1');
	await subject.importPage(ctx, 'page-1');

	assert.equal(ctx.progressTotal, 1);
	assert.equal(ctx.progressCurrent, 1);
});

test('a page that fails counts too, so remaining still reaches zero', async () => {
	const { subject, ctx } = await importer();
	subject.useFailingClient();

	await subject.importPage(ctx, 'page-1');

	assert.deepEqual(ctx.failed.length, 1);
	assert.equal(remaining(ctx), 0);
});

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
