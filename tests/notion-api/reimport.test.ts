/**
 * What a second Notion API import does to a vault the first one already filled.
 *
 * The importer reads a workspace over the API, so the fixture is a saved set of
 * responses: the page envelope GET /v1/pages/{id} returns, and the children of
 * every block that has them. The client here answers out of that rather than
 * over the network, which is what lets the same workspace be imported twice.
 *
 * This is the baseline the shared duplicate-handling work is measured against:
 * it records what Skip and "Create a copy" do today, before either importer
 * moves onto the shared resolve/write primitives. A refactor that changes what
 * is recorded here has changed behaviour.
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
	nodeFs.readFileSync(nodePath.join(__dirname, 'reimport-workspace.json'), 'utf8')
) as Workspace;

const ROOT_PAGE = '10000000-0000-4000-8000-000000000101';
const CHILD_PAGE = '10000000-0000-4000-8000-000000000102';
const OUTPUT = 'Notion';

const EMPTY = { object: 'list', results: [], has_more: false, next_cursor: null };

/** The seam the harness needs: a stubbed client, and one page to start from. */
class ImportingTwice extends NotionAPIImporter {
	answerFromFixture(): void {
		this.notionClient = {
			pages: {
				retrieve: async ({ page_id }: { page_id: string }) => {
					const page = workspace.pages[page_id];
					if (!page) throw new Error(`no page ${page_id} in the fixture`);
					return page;
				},
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

	importPage(ctx: ImportContext, pageId: string): Promise<void> {
		return this.fetchAndImportPage({ ctx, pageId, parentPath: OUTPUT });
	}
}

/** One import of the whole fixture, over a vault that may already hold one. */
async function importOnce(vault: MemoryVault, mode: DuplicateHandling, saveSourceId = true): Promise<ImportContext> {
	const subject = new ImportingTwice(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.saveSourceId = saveSourceId;
	subject.answerFromFixture();
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	await subject.importPage(ctx, ROOT_PAGE);
	return ctx;
}

async function vaultWithOneImport(mode: DuplicateHandling): Promise<MemoryVault> {
	const vault = new MemoryVault();
	await vault.createFolder(OUTPUT);
	await importOnce(vault, mode);
	return vault;
}

const markdown = (vault: MemoryVault) => vault.paths().filter(path => path.endsWith('.md')).sort();

test('a first import writes the page and its child', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), [
		'Notion/Roadmap/Milestones.md',
		'Notion/Roadmap/Roadmap.md',
	]);
});

test('every note it wrote carries the id the next import recognises it by', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	for (const path of markdown(vault)) {
		assert.match(String(vault.contents.get(path)), new RegExp(`${NOTION_ID_PROPERTY}: `), path);
	}
});

test('importing again with "Skip" leaves the vault as it was', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);
	const before = markdown(vault).map(path => [path, vault.contents.get(path)] as const);

	const second = await importOnce(vault, DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), before.map(([path]) => path), 'no note should have been added');
	for (const [path, content] of before) {
		assert.equal(vault.contents.get(path), content, `${path} should be untouched`);
	}
	assert.equal(second.skipped.length, 2, 'both notes should be reported as skipped');
});

// The page folder is reused whatever the mode, so the copies are numbered
// inside it rather than landing in a second "Roadmap 1" folder.
test('importing again with "Create a copy" numbers the notes inside the same folder', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.CreateCopy);

	await importOnce(vault, DuplicateHandling.CreateCopy);

	assert.deepEqual(markdown(vault), [
		'Notion/Roadmap/Milestones 1.md',
		'Notion/Roadmap/Milestones.md',
		'Notion/Roadmap/Roadmap 1.md',
		'Notion/Roadmap/Roadmap.md',
	]);
});

test('a note the user moved is still recognised, because the id travels with it', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);
	const moved = 'Archive/Roadmap.md';
	await vault.createFolder('Archive');
	await vault.create(moved, String(vault.contents.get('Notion/Roadmap/Roadmap.md')));
	vault.contents.delete('Notion/Roadmap/Roadmap.md');

	const second = await importOnce(vault, DuplicateHandling.Skip);

	assert.ok(markdown(vault).includes(moved), 'the moved note should still be there');
	assert.ok(
		!markdown(vault).includes('Notion/Roadmap/Roadmap.md'),
		'a note it already has should not be written again at the old path'
	);
	assert.equal(second.skipped.length, 2);
});
