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
const EMPTY = { object: 'list', results: [], has_more: false, next_cursor: null };

class ImportingSyncedBlocks extends NotionAPIImporter {
	answerFromFixture(): void {
		this.notionClient = {
			pages: {
				retrieve: async ({ page_id }: { page_id: string }) => workspace.pages[page_id],
			},
			blocks: {
				children: {
					list: async ({ block_id }: { block_id: string }) => workspace.blocks[block_id] ?? EMPTY,
				},
				retrieve: async ({ block_id }: { block_id: string }) => {
					for (const { results } of Object.values(workspace.blocks)) {
						const block = (results as { id: string }[]).find(candidate => candidate.id === block_id);
						if (block) return block;
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
}

async function importOnce(vault: MemoryVault, mode: DuplicateHandling, saveSourceId = true) {
	const subject = new ImportingSyncedBlocks(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.saveSourceId = saveSourceId;
	subject.answerFromFixture();
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	await subject.importPage(ctx);

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

test('each synced block on a page gets a note of its own', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), [CHILD_NOTE, ...SYNCED, PAGE_NOTE]);
});

test('and carries the id of the block it holds', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	assert.match(String(vault.contents.get(SYNCED[1])), new RegExp(`${NOTION_ID_PROPERTY}: ${FIRST_BLOCK}`));
});

test('a second import leaves them alone rather than writing more', async () => {
	for (const mode of [DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const vault = await vaultWithOneImport(mode);

		await importOnce(vault, mode);

		assert.deepEqual(markdown(vault), [CHILD_NOTE, ...SYNCED, PAGE_NOTE], mode);
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

	assert.deepEqual(markdown(vault), [CHILD_NOTE, ...SYNCED, PAGE_NOTE]);
});

// With the id turned off there is nothing to recognise them by, so a second
// import writes its own. Worth knowing rather than worth pretending otherwise.
test('with "Save source ID" off, the id is cleared once the import is done', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	const { ctx, subject } = await importOnce(vault, DuplicateHandling.Skip, false);
	await subject.cleanUp(ctx);

	for (const path of SYNCED) {
		assert.doesNotMatch(String(vault.contents.get(path)), new RegExp(NOTION_ID_PROPERTY), path);
	}
});
