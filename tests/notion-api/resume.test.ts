import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotionAPIImporter } from '../../src/formats/notion-api';
import { DuplicateHandling } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { NOTION_ID_PROPERTY } from '../../src/constants';
import { MemoryVault, memoryApp } from '../shims/vault';

const PAGE_ID = 'abc-123';
const PAGE_PATH = 'Notion/Roadmap.md';

class ResumingImporter extends NotionAPIImporter {
	skips(filePath: string, notionId: string, ctx: ImportContext) {
		return this.shouldSkipExistingFile(filePath, notionId, ctx);
	}

	cleanUp(ctx: ImportContext) {
		return this.cleanupNotionIds(ctx);
	}
}

async function importing(mode: DuplicateHandling, saveSourceId: boolean) {
	const vault = new MemoryVault();
	await vault.create(PAGE_PATH, `---\n${NOTION_ID_PROPERTY}: ${PAGE_ID}\n---\nThe body.\n`);

	const subject = new ResumingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.saveSourceId = saveSourceId;
	subject.indexImportedNotes();

	return { vault, subject, ctx: new ImportContext() };
}

test('a page an unfinished import wrote is not written twice', async () => {
	const { subject, ctx } = await importing(DuplicateHandling.CreateCopy, false);

	assert.equal(await subject.skips(PAGE_PATH, PAGE_ID, ctx), true);
	assert.equal(ctx.skipped.length, 1);
});

test('and its id is cleared, so the next import stops recognising it', async () => {
	const { vault, subject, ctx } = await importing(DuplicateHandling.CreateCopy, false);

	await subject.skips(PAGE_PATH, PAGE_ID, ctx);
	await subject.cleanUp(ctx);

	assert.doesNotMatch(String(vault.contents.get(PAGE_PATH)), new RegExp(NOTION_ID_PROPERTY));
	assert.match(String(vault.contents.get(PAGE_PATH)), /The body\./);
});

test('a page the user asked to skip keeps its id', async () => {
	const { vault, subject, ctx } = await importing(DuplicateHandling.Skip, true);

	assert.equal(await subject.skips(PAGE_PATH, PAGE_ID, ctx), true);
	await subject.cleanUp(ctx);

	assert.match(String(vault.contents.get(PAGE_PATH)), new RegExp(`${NOTION_ID_PROPERTY}: ${PAGE_ID}`));
});

test('with ids kept, "Create a copy" copies rather than recognising anything', async () => {
	const { subject, ctx } = await importing(DuplicateHandling.CreateCopy, true);

	assert.equal(await subject.skips(PAGE_PATH, PAGE_ID, ctx), false);
	assert.deepEqual(ctx.skipped, []);
});

test('a page carrying a different id is not one of ours', async () => {
	const { subject, ctx } = await importing(DuplicateHandling.CreateCopy, false);

	assert.equal(await subject.skips(PAGE_PATH, 'def-456', ctx), false);
});

test('a page that fails before its title loads keeps its full Notion id', async () => {
	const vault = new MemoryVault();
	const subject = new ResumingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	const ctx = new ImportContext();

	(subject as unknown as { notionClient: unknown }).notionClient = {
		pages: {
			retrieve: async () => {
				throw Object.assign(new Error('Page could not be read'), { status: 404 });
			},
		},
	};

	await (subject as unknown as {
		fetchAndImportPage(params: { ctx: ImportContext, pageId: string, parentPath: string }): Promise<void>;
	}).fetchAndImportPage({ ctx, pageId: PAGE_ID, parentPath: 'Notion' });

	assert.deepEqual(ctx.failed, [`Page ${PAGE_ID}`]);
});
