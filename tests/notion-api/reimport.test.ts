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

import type { TFile, TFolder } from 'obsidian';

import { childFolderOf, NotionAPIImporter } from '../../src/formats/notion-api';
import { DuplicateHandling, PlannedNote } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { NOTION_ID_PROPERTY } from '../../src/constants';
import { answerRequests } from '../shims/obsidian';
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
	/** Every path this import settled on, before it wrote anything. */
	readonly planned: string[] = [];

	planNote(folder: TFolder | string, title: string, sourceId?: string): PlannedNote {
		const note = super.planNote(folder, title, sourceId);
		this.planned.push(note.targetPath);

		return note;
	}

	/** Whether the passes after the import will rewrite this note. */
	queuedForRewriting(path: string): boolean {
		return this.mentionPlaceholders.has(path);
	}

	answerFromFixture(editedAt?: string): void {
		this.notionClient = {
			pages: {
				retrieve: async ({ page_id }: { page_id: string }) => {
					const page = workspace.pages[page_id];
					if (!page) throw new Error(`no page ${page_id} in the fixture`);

					// Standing in for someone editing the page in Notion.
					return editedAt ? { ...(page as object), last_edited_time: editedAt } : page;
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

/** Every URL the import asked for, so a second one can be shown not to ask. */
const fetched: string[] = [];

answerRequests(request => {
	fetched.push(request.url);

	return { status: 200, arrayBuffer: new Uint8Array([137, 80, 78, 71]).buffer, text: '', headers: {} } as never;
});

interface Run {
	saveSourceId?: boolean;
	/** When Notion last changed every page, for a run that follows an edit. */
	editedAt?: string;
}

/** One import of the whole fixture, over a vault that may already hold one. */
async function importOnce(
	vault: MemoryVault,
	mode: DuplicateHandling,
	{ saveSourceId = true, editedAt }: Run = {},
): Promise<{ ctx: ImportContext, subject: ImportingTwice }> {
	const subject = new ImportingTwice(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.saveSourceId = saveSourceId;
	subject.answerFromFixture(editedAt);
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	const before = new Set(vault.paths());
	await subject.importPage(ctx, ROOT_PAGE);

	// The conversion resolves attachments and links against the path the note
	// was planned at, so a note that lands anywhere else leaves all of it
	// pointing at a file that is not there. Choosing the path a second time
	// after converting is exactly how that used to happen.
	for (const path of vault.paths()) {
		if (before.has(path) || !path.endsWith('.md')) continue;
		assert.ok(subject.planned.includes(path), `${path} was written but never planned`);
	}

	return { ctx, subject };
}

async function vaultWithOneImport(mode: DuplicateHandling): Promise<MemoryVault> {
	const vault = new MemoryVault();
	await vault.createFolder(OUTPUT);
	await importOnce(vault, mode);
	fetched.length = 0;

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

	const { ctx: second } = await importOnce(vault, DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), before.map(([path]) => path), 'no note should have been added');
	for (const [path, content] of before) {
		assert.equal(vault.contents.get(path), content, `${path} should be untouched`);
	}
	assert.equal(second.skipped.length, 2, 'both notes should be reported as skipped');
});

// The copy is a page in its own right, so it keeps its children in a folder
// of its own name. They used to be numbered alongside the first import's,
// which left no way to tell which copy a child belonged to.
test('importing again with "Create a copy" gives the copy its own children', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.CreateCopy);

	await importOnce(vault, DuplicateHandling.CreateCopy);

	assert.deepEqual(markdown(vault), [
		'Notion/Roadmap/Milestones.md',
		'Notion/Roadmap/Roadmap 1.md',
		'Notion/Roadmap/Roadmap 1/Milestones.md',
		'Notion/Roadmap/Roadmap.md',
	]);
});

test('the first import fetches what the page points at', async () => {
	const vault = new MemoryVault();
	await vault.createFolder(OUTPUT);
	fetched.length = 0;

	await importOnce(vault, DuplicateHandling.Skip);

	// Twice: how big it is, then the bytes. The shim answers a range request
	// with a whole response, which is what turns the probing off after one go.
	assert.deepEqual([...new Set(fetched)], ['https://example.invalid/roadmap-chart.png']);
	assert.equal(fetched.length, 2);
	assert.ok(vault.paths().some(path => path.endsWith('roadmap-chart.png')));
});

// The page is still walked - a child of it may have changed - but nothing the
// walk turns up is downloaded, because the markdown around it is thrown away.
test('a second import fetches nothing for a page it is leaving alone', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	await importOnce(vault, DuplicateHandling.Skip);

	assert.deepEqual(fetched, []);
});

test('and the walk still reaches a child that is no longer there', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);
	vault.remove('Notion/Roadmap/Milestones.md');

	await importOnce(vault, DuplicateHandling.Skip);

	assert.ok(
		markdown(vault).includes('Notion/Roadmap/Milestones.md'),
		'the parent was skipped, but its child was reached through it'
	);
	assert.deepEqual(fetched, [], 'and the parent still fetched nothing of its own');
});

const ROADMAP = 'Notion/Roadmap/Roadmap.md';
/** What the fixture says Notion last changed the page. */
const NOTION_EDITED = '2024-03-01T00:00:00.000Z';
const LATER = '2024-09-01T00:00:00.000Z';

/** Stand in for the user editing a note in Obsidian after the import. */
async function editInObsidian(vault: MemoryVault, path: string, body: string, at: string): Promise<void> {
	const file = vault.getAbstractFileByPath(path) as unknown as TFile;
	await vault.modify(file, body, { mtime: Date.parse(at), ctime: file.stat.ctime });
}

const modifiedAt = (vault: MemoryVault, path: string) =>
	(vault.getAbstractFileByPath(path) as unknown as TFile).stat.mtime;

test('the importer offers all three ways of meeting a note it already wrote', () => {
	const subject = new ImportingTwice(memoryApp(new MemoryVault()), { sourceEl: null, optionsEl: null } as never);

	assert.deepEqual(subject.duplicateModes, [
		DuplicateHandling.CreateCopy,
		DuplicateHandling.Skip,
		DuplicateHandling.Update,
	]);
});

test('"Update" leaves a page Notion has not changed since the import', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const before = vault.contents.get(ROADMAP);

	const { ctx } = await importOnce(vault, DuplicateHandling.Update);

	assert.equal(vault.contents.get(ROADMAP), before);
	assert.equal(ctx.skipped.length, 2);
	assert.deepEqual(fetched, [], 'and it is known to be unchanged without reading a word of it');
});

// The body the user replaced comes back, in the note they replaced it in,
// because Notion changed the page after they did.
test('"Update" writes over a page Notion has changed, in place', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	await editInObsidian(vault, ROADMAP, 'Something else entirely.\n', '2024-04-01T00:00:00.000Z');

	const { ctx } = await importOnce(vault, DuplicateHandling.Update, { editedAt: LATER });

	assert.deepEqual(markdown(vault), ['Notion/Roadmap/Milestones.md', ROADMAP], 'no second copy');
	assert.match(String(vault.contents.get(ROADMAP)), /What we are building this year\./);
	assert.ok(!ctx.skipped.includes('Roadmap'), 'the note was written, not passed over');
	assert.equal(modifiedAt(vault, ROADMAP), Date.parse(LATER), 'stamped with when Notion changed it');
});

test('"Update" does not write over work done in Obsidian since the import', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	const mine = `---\n${NOTION_ID_PROPERTY}: ${ROOT_PAGE}\n---\nMy own notes.\n`;
	await editInObsidian(vault, ROADMAP, mine, '2024-12-01T00:00:00.000Z');

	await importOnce(vault, DuplicateHandling.Update, { editedAt: LATER });

	assert.equal(vault.contents.get(ROADMAP), mine, 'the note is the user\'s now');
});

// The three ways of leaving a note alone are not the same. Two of them let the
// passes after the import repair links an interrupted run left unresolved; the
// third is a note the user owns, which nothing here may write to.
test('a note left alone can still have its unresolved links repaired', async () => {
	for (const mode of [DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const vault = await vaultWithOneImport(mode);
		await editInObsidian(vault, ROADMAP,
			`---\n${NOTION_ID_PROPERTY}: ${ROOT_PAGE}\n---\n[[NOTION_PAGE:${CHILD_PAGE}]]\n`,
			NOTION_EDITED);

		const { subject } = await importOnce(vault, mode);

		assert.equal(subject.queuedForRewriting(ROADMAP), true, mode);
	}
});

test('but a note the user has edited is not queued for rewriting at all', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Update);
	await editInObsidian(vault, ROADMAP,
		`---\n${NOTION_ID_PROPERTY}: ${ROOT_PAGE}\n---\n[[NOTION_PAGE:${CHILD_PAGE}]] and my own notes.\n`,
		'2024-12-01T00:00:00.000Z');

	const { subject } = await importOnce(vault, DuplicateHandling.Update, { editedAt: LATER });

	assert.equal(subject.queuedForRewriting(ROADMAP), false);
});

test('a page with children keeps them in the folder holding its note', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);

	assert.equal(childFolderOf('Notion/Roadmap/Roadmap.md'), 'Notion/Roadmap');
	assert.ok(markdown(vault).includes('Notion/Roadmap/Milestones.md'));
});

// The note was written when the page had nothing under it, so it is not in a
// folder of its own. It stays where it is and the children arrive beside it.
test('a page that has grown children leaves its note where it is', async () => {
	assert.equal(childFolderOf('Notion/Roadmap.md'), 'Notion/Roadmap');
});

test('and a note the user moved takes its children with it', async () => {
	assert.equal(childFolderOf('Archive/Roadmap.md'), 'Archive/Roadmap');
});

// The parent is recognised where the user put it and skipped, but its child
// is gone and imported again - into the folder belonging to the note that
// actually exists, not the one this import would have made.
test('a moved page is where its children are put', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);
	await vault.createFolder('Archive');
	await vault.create('Archive/Roadmap.md', String(vault.contents.get('Notion/Roadmap/Roadmap.md')));
	vault.remove('Notion/Roadmap/Roadmap.md');
	vault.remove('Notion/Roadmap/Milestones.md');

	await importOnce(vault, DuplicateHandling.Skip);

	assert.deepEqual(markdown(vault), ['Archive/Roadmap.md', 'Archive/Roadmap/Milestones.md']);
});

test('a note the user moved is still recognised, because the id travels with it', async () => {
	const vault = await vaultWithOneImport(DuplicateHandling.Skip);
	const moved = 'Archive/Roadmap.md';
	await vault.createFolder('Archive');
	await vault.create(moved, String(vault.contents.get('Notion/Roadmap/Roadmap.md')));
	vault.remove('Notion/Roadmap/Roadmap.md');

	const { ctx: second } = await importOnce(vault, DuplicateHandling.Skip);

	assert.ok(markdown(vault).includes(moved), 'the moved note should still be there');
	assert.ok(
		!markdown(vault).includes('Notion/Roadmap/Roadmap.md'),
		'a note it already has should not be written again at the old path'
	);
	assert.equal(second.skipped.length, 2);
});
