/**
 * Picking up a Notion import that did not finish.
 *
 * The notion-id is written into each page as it is imported and taken out
 * again once the import completes, so an id still sitting in a note is one a
 * finished import would have cleaned up - which is what lets a re-run tell a
 * page an interrupted import already wrote from a page it has never seen.
 * "Create a copy" copies everything else.
 *
 * Two bugs have come from the two halves of that disagreeing about which notes
 * the run owns. Skipping a recovered page but leaving its id behind is the
 * worse one: every later import reads it as another unfinished run and skips
 * the page again, so the page is never copied and the id is never cleared.
 */
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

/** Exposes the two halves, which are protected for the importer's own use. */
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
	// Left behind, every later "Create a copy" run reads the id as another
	// unfinished import and skips the page for good.
	const { vault, subject, ctx } = await importing(DuplicateHandling.CreateCopy, false);

	await subject.skips(PAGE_PATH, PAGE_ID, ctx);
	await subject.cleanUp(ctx);

	assert.doesNotMatch(String(vault.contents.get(PAGE_PATH)), new RegExp(NOTION_ID_PROPERTY));
	assert.match(String(vault.contents.get(PAGE_PATH)), /The body\./);
});

test('a page the user asked to skip keeps its id', async () => {
	// Not this run's to touch: it was not written by an import that failed
	// half way, and taking the id out would leave nothing to recognise it by.
	const { vault, subject, ctx } = await importing(DuplicateHandling.Skip, true);

	assert.equal(await subject.skips(PAGE_PATH, PAGE_ID, ctx), true);
	await subject.cleanUp(ctx);

	assert.match(String(vault.contents.get(PAGE_PATH)), new RegExp(`${NOTION_ID_PROPERTY}: ${PAGE_ID}`));
});

test('with ids kept, "Create a copy" copies rather than recognising anything', async () => {
	// A page a perfectly finished import wrote carries an id too, so there is
	// nothing to tell it from one an unfinished run left. Copying is what the
	// mode says, so copying is the answer.
	const { subject, ctx } = await importing(DuplicateHandling.CreateCopy, true);

	assert.equal(await subject.skips(PAGE_PATH, PAGE_ID, ctx), false);
	assert.deepEqual(ctx.skipped, []);
});

test('a page carrying a different id is not one of ours', async () => {
	const { subject, ctx } = await importing(DuplicateHandling.CreateCopy, false);

	assert.equal(await subject.skips(PAGE_PATH, 'def-456', ctx), false);
});
