/**
 * The note a synced block keeps, across more than one import.
 *
 * A synced block is content Notion shows in several places at once, so the
 * importer gives it a note of its own and embeds that note wherever the block
 * appears. It used to ask for a name nothing was using, which meant every
 * import wrote another one: "Handbook synced block 1.md", then
 * "Handbook synced block 2.md", and so on for as long as the user kept
 * importing.
 *
 * The note carries the block's id now, so a later import finds the one it
 * wrote before.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { NotionAPIImporter } from '../../src/formats/notion-api';
import { DuplicateHandling } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { NOTION_ID_PROPERTY } from '../../src/constants';
import { createPlaceholder, PlaceholderType } from '../../src/formats/notion-api/utils';
import type { TFile } from 'obsidian';

import { MemoryVault, memoryApp } from '../shims/vault';

interface Workspace {
	pages: Record<string, unknown>;
	blocks: Record<string, { results: unknown[], has_more: boolean, next_cursor: string | null }>;
}

const workspace = JSON.parse(
	nodeFs.readFileSync(nodePath.join(__dirname, 'synced-workspace.json'), 'utf8')
) as Workspace;

const PAGE = '10000000-0000-4000-8000-000000000201';
const FIRST_BLOCK = '30000000-0000-4000-8000-000000000201';
const CHAPTER_ONE = '10000000-0000-4000-8000-000000000202';
const EMPTY = { object: 'list', results: [], has_more: false, next_cursor: null };

class ImportingSyncedBlocks extends NotionAPIImporter {
	answerFromFixture(editedAt?: string): void {
		const edited = <T>(value: T): T =>
			editedAt ? { ...(value as object), last_edited_time: editedAt } as T : value;

		this.notionClient = {
			pages: {
				retrieve: async ({ page_id }: { page_id: string }) => edited(workspace.pages[page_id]),
			},
			blocks: {
				children: {
					list: async ({ block_id }: { block_id: string }) => workspace.blocks[block_id] ?? EMPTY,
				},
				retrieve: async ({ block_id }: { block_id: string }) => {
					for (const { results } of Object.values(workspace.blocks)) {
						const block = (results as { id: string }[]).find(candidate => candidate.id === block_id);
						if (block) return edited(block);
					}
					throw new Error(`no block ${block_id} in the fixture`);
				},
			},
		} as never;
	}

	importPage(ctx: ImportContext): Promise<void> {
		return this.fetchAndImportPage({ ctx, pageId: PAGE, parentPath: 'Notion' });
	}

	cleanUp(ctx: ImportContext): Promise<void> {
		return this.cleanupNotionIds(ctx);
	}

	/** The pass that resolves what a synced block holds, run as import() runs it. */
	finishSyncedBlocks(ctx: ImportContext): Promise<void> {
		return this.replaceSyncedChildPlaceholders(ctx);
	}
}

async function importOnce(vault: MemoryVault, mode: DuplicateHandling, saveSourceId = true, editedAt?: string) {
	const subject = new ImportingSyncedBlocks(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.saveSourceId = saveSourceId;
	subject.answerFromFixture(editedAt);
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	await subject.importPage(ctx);
	await subject.finishSyncedBlocks(ctx);

	return { ctx, subject };
}

async function vaultWithOneImport(mode: DuplicateHandling, saveSourceId = true): Promise<MemoryVault> {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	await importOnce(vault, mode, saveSourceId);

	return vault;
}

const markdown = (vault: MemoryVault) => vault.paths().filter(path => path.endsWith('.md')).sort();

// The page has a child page, so it is a folder, and its synced blocks go in
// there beside its note. That it has children is what keeps the page being
// converted on a later import even when its note is left alone - which is
// exactly when another synced block note used to appear.
const SYNCED = [
	'Notion/Handbook/Handbook synced block 1.md',
	'Notion/Handbook/Handbook synced block.md',
];
const PAGE_NOTE = 'Notion/Handbook/Handbook.md';
const CHILD_NOTE = 'Notion/Handbook/Chapter one.md';
// A page inside a synced block is not imported where it stands: it is noted
// and fetched afterwards, into the import's root folder.
const NESTED = 'Nested in a synced block.md';
const EVERYTHING = [NESTED, CHILD_NOTE, ...SYNCED, PAGE_NOTE];

test('each synced block on a page gets a note of its own', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), EVERYTHING);
});

test('and carries the id of the block it holds', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	assert.match(String(vault.contents.get(SYNCED[1])), new RegExp(`${NOTION_ID_PROPERTY}: ${FIRST_BLOCK}`));
});

test('a second import leaves them alone rather than writing more', async () => {
	for (const mode of [DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const vault = await vaultWithOneImport(mode);

		await importOnce(vault, mode);

		assert.deepEqual(markdown(vault), EVERYTHING, mode);
	}
});

// The two of them share a generated name, so the second is "… 1.md". Which
// one that is has to hold from one import to the next, or they swap contents.
test('and the two of them keep the notes they had', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const before = SYNCED.map(path => vault.contents.get(path));

	await importOnce(vault, DuplicateHandling.Update);

	assert.deepEqual(SYNCED.map(path => vault.contents.get(path)), before);
});

test('a third import adds nothing either', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	await importOnce(vault, DuplicateHandling.Skip);
	await importOnce(vault, DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), EVERYTHING);
});

// The id goes in whether or not it is being kept, so that an import which is
// interrupted leaves notes the next one can recognise as its own. Only at the
// end is it taken back out.
test('with "Save source ID" off, the id is written and then cleared', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	const { ctx, subject } = await importOnce(vault, DuplicateHandling.Skip, false);

	for (const path of SYNCED) {
		assert.match(String(vault.contents.get(path)), new RegExp(`${NOTION_ID_PROPERTY}: `), `${path} before`);
	}

	await subject.cleanUp(ctx);

	for (const path of SYNCED) {
		assert.doesNotMatch(String(vault.contents.get(path)), new RegExp(NOTION_ID_PROPERTY), `${path} after`);
		assert.match(String(vault.contents.get(path)), /How we work\.|Who to ask\./, `${path} kept its content`);
	}
});

// "Create a copy" turns off the index of ids, so the only way to know a note
// is one this run wrote is to read it. Without that, resuming a run that was
// interrupted before its ids were cleared writes the whole lot again.
test('resuming an interrupted "Create a copy" writes no second set', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	await importOnce(vault, DuplicateHandling.CreateCopy, false);
	const before = markdown(vault);

	// The run ended here, before cleanupNotionIds could take the ids out.
	const { ctx, subject } = await importOnce(vault, DuplicateHandling.CreateCopy, false);

	assert.deepEqual(markdown(vault), before);
	await subject.cleanUp(ctx);

	for (const path of SYNCED) {
		assert.doesNotMatch(String(vault.contents.get(path)), new RegExp(NOTION_ID_PROPERTY), path);
	}
});

test('and each note is recognised as the block it holds, not merely as taken', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	await importOnce(vault, DuplicateHandling.CreateCopy, false);

	// Both blocks want the same name, so the second is under "… 1.md". A
	// resumed run has to look past the first name to find it.
	const second = String(vault.contents.get(SYNCED[0]));
	await importOnce(vault, DuplicateHandling.CreateCopy, false);

	assert.equal(vault.contents.get(SYNCED[0]), second);
	assert.deepEqual(markdown(vault).filter(path => SYNCED.includes(path)), SYNCED);
});

const NOTION_EDITED = '2024-03-01T00:00:00.000Z';
const LATER = '2024-09-01T00:00:00.000Z';

/** Stand in for the user editing a synced block's note in Obsidian. */
async function editInObsidian(vault: MemoryVault, path: string, body: string, at: string): Promise<void> {
	const file = vault.getAbstractFileByPath(path) as unknown as TFile;
	await vault.modify(file, body, { mtime: Date.parse(at), ctime: file.stat.ctime });
}

test('a synced block note is stamped with when Notion last changed the block', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const file = vault.getAbstractFileByPath(SYNCED[1]) as unknown as TFile;

	assert.equal(file.stat.mtime, Date.parse(NOTION_EDITED));
});

test('"Update" leaves a synced block Notion has not changed since', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const before = vault.contents.get(SYNCED[1]);

	await importOnce(vault, DuplicateHandling.Update);

	assert.equal(vault.contents.get(SYNCED[1]), before);
});

test('"Update" writes over a synced block Notion has changed', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	await editInObsidian(vault, SYNCED[1], 'Something else entirely.\n', '2024-04-01T00:00:00.000Z');

	await importOnce(vault, DuplicateHandling.Update, true, LATER);

	assert.match(String(vault.contents.get(SYNCED[1])), /How we work\./);
	assert.deepEqual(markdown(vault), EVERYTHING, 'and does not write a second one');
});

// An earlier run may have stopped before it could turn a placeholder into a
// link, and what it left behind is in the note rather than in what the source
// converts to now. Repair has to read the note, or a placeholder for something
// the source has since stopped mentioning stays in the file forever.
test('a placeholder an interrupted run left behind is repaired from the note', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const stale = createPlaceholder(PlaceholderType.SYNCED_CHILD_PAGE, CHAPTER_ONE);
	await editInObsidian(vault, SYNCED[1],
		`---\n${NOTION_ID_PROPERTY}: ${FIRST_BLOCK}\n---\nHow we work.\n\n${stale}\n`,
		NOTION_EDITED);

	await importOnce(vault, DuplicateHandling.Update);

	const repaired = String(vault.contents.get(SYNCED[1]));
	assert.ok(!repaired.includes(stale), 'the placeholder should be gone');
	assert.match(repaired, /Chapter one/, 'replaced with a link to the page it named');
});

// What is under a synced block and what its note says are two questions. The
// note the user edited is theirs and is never rewritten; the page beneath it
// is still theirs to have, and is fetched whether or not the note mentions it.
test('a page under a synced block arrives even when the note is left alone', async () => {
	for (const mode of [DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const vault = await vaultWithOneImport(mode);
		vault.remove(NESTED);

		await importOnce(vault, mode);

		assert.ok(markdown(vault).includes(NESTED), mode);
	}
});

test('and even when the note is one the user has edited', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const mine = 'My own notes on how we work.\n';
	await editInObsidian(vault, SYNCED[1], mine, '2024-12-01T00:00:00.000Z');
	vault.remove(NESTED);

	await importOnce(vault, DuplicateHandling.Update, true, LATER);

	assert.ok(markdown(vault).includes(NESTED), 'the page under it is still fetched');
	assert.equal(vault.contents.get(SYNCED[1]), mine, 'and the note is untouched');
});

test('"Update" does not write over a synced block note edited in Obsidian', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const mine = 'My own notes on how we work.\n';
	await editInObsidian(vault, SYNCED[1], mine, '2024-12-01T00:00:00.000Z');

	await importOnce(vault, DuplicateHandling.Update, true, LATER);

	assert.equal(vault.contents.get(SYNCED[1]), mine);
	assert.deepEqual(markdown(vault), EVERYTHING, 'and does not write a second one');
});
