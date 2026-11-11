/**
 * Synthetic graphs for issue #666, adapted from the issue comment: a row whose
 * page holds a linked view of the database the row is in.
 *
 * `empty-source` is what Notion returns for a linked view today. Nobody has
 * captured `shared-source`, a view that names its owner's data source, so it
 * is a guard rather than a recording. live.test.ts checks the ownership rule
 * both rest on.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotionAPIImporter } from '../../src/formats/notion-api';
import { DuplicateHandling } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { NOTION_ID_PROPERTY } from '../../src/constants';
import { createDatabaseLookups } from '../../src/formats/notion-api/api-helpers';
import { convertChildDatabase, importDatabaseCore } from '../../src/formats/notion-api/database-helpers';
import type { DatabaseProcessingContext } from '../../src/formats/notion-api/types';
import { createPlaceholder, PlaceholderType } from '../../src/formats/notion-api/utils';
import { answerRequests } from '../shims/obsidian';
import { MemoryVault, memoryApp } from '../shims/vault';

const ids = {
	root: '10000000-0000-4000-8000-000000000001',
	source: '10000000-0000-4000-8000-000000000002',
	album: '10000000-0000-4000-8000-000000000003',
	photo: '10000000-0000-4000-8000-000000000004',
	task: '10000000-0000-4000-8000-000000000005',
	wrapper: '10000000-0000-4000-8000-000000000006',
};
const OUTPUT = 'Notion';
const BASE = `${OUTPUT}/Projects/Projects.base`;
const UNSUPPORTED = '<!-- Linked database (not supported by Notion API) -->';
const pages = [
	{ id: ids.album, title: 'Album A', body: 'Made-up album note' },
	{ id: ids.photo, title: 'Photo B', body: 'Made-up photo note' },
	{ id: ids.task, title: 'Task C', body: 'Made-up unrelated note' },
];
type View = 'ordinary' | 'shared-source' | 'empty-source';

function richText(content: string) {
	return {
		type: 'text', text: { content, link: null }, plain_text: content, href: null,
		annotations: { bold: false, italic: false, strikethrough: false,
			underline: false, code: false, color: 'default' },
	};
}

function graphFor(view: View) {
	const times = { created_time: '2024-01-01T00:00:00.000Z', last_edited_time: '2024-03-01T00:00:00.000Z' };
	const database = (id: string, title: string, data_sources: { id: string, name: string }[]) => ({
		object: 'database', id, title: [richText(title)], data_sources,
		...times, archived: false, in_trash: false,
	});
	const sources = [{ id: ids.source, name: 'Projects' }];
	const databases: Record<string, unknown> = { [ids.root]: database(ids.root, 'Projects', sources) };
	if (view !== 'ordinary') {
		databases[ids.wrapper] = database(ids.wrapper, 'Untitled', view === 'shared-source' ? sources : []);
	}
	const source = {
		object: 'data_source', id: ids.source, name: 'Projects', title: [richText('Projects')],
		parent: { type: 'database_id', database_id: ids.root },
		properties: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } }, ...times,
	};
	const rows = pages.map(page => ({
		object: 'page', id: page.id, ...times, archived: false, in_trash: false, icon: null, cover: null,
		parent: { type: 'data_source_id', data_source_id: ids.source },
		properties: { Name: { id: 'title', type: 'title', title: [richText(page.title)] } },
	}));
	const blocks: Record<string, unknown> = {};
	for (const [index, page] of pages.entries()) {
		const results: unknown[] = [{
			object: 'block', id: `20000000-0000-4000-8000-00000000000${index + 3}`,
			type: 'paragraph', has_children: false, archived: false, in_trash: false,
			paragraph: { rich_text: [richText(page.body)], color: 'default' },
		}];
		if (page.id === ids.album && view !== 'ordinary') {
			results.push({ object: 'block', id: ids.wrapper, type: 'child_database', has_children: false,
				archived: false, in_trash: false, child_database: { title: 'Untitled' } });
		}
		blocks[page.id] = { object: 'list', results, has_more: false, next_cursor: null };
	}
	return { databases, source, rows, blocks };
}

/** The upstream fake adapter checks file contents only; folders must exist too. */
class FolderAwareVault extends MemoryVault {
	constructor() {
		super();
		this.adapter.exists = async path => this.getAbstractFileByPath(path) !== null;
	}
}

class DatabaseImporter extends NotionAPIImporter {
	async importGraph(ctx: ImportContext, client: unknown, entry: 'database-id' | 'data-source-id') {
		this.notionClient = client as never;
		(this as any).outputRootPath = OUTPUT;
		this.indexImportedNotes();
		await this.importTopLevelDatabase(ctx, entry === 'database-id' ? ids.root : ids.source, OUTPUT, { isDataSourceId: entry === 'data-source-id' });
		await this.reachSyncedChildren(ctx);
		await (this as any).replaceRelationPlaceholders(ctx);
		await (this as any).replaceMentionPlaceholdersInAllFiles(ctx);
		await this.replaceSyncedChildPlaceholders(ctx);
	}

	async resolveSyncedDatabase(ctx: ImportContext, client: unknown, filePath: string, databaseId: string) {
		this.notionClient = client as never;
		(this as any).outputRootPath = OUTPUT;
		(this as any).syncedChildDatabasePlaceholders.set(filePath, new Set([databaseId]));
		await this.replaceSyncedChildPlaceholders(ctx);
	}
}

async function importerFor(vault: MemoryVault, mode = DuplicateHandling.Skip) {
	const subject = new DatabaseImporter(memoryApp(vault), {
		sourceEl: null, optionsEl: null, plugin: { loadData: async () => ({}) },
	} as never);
	subject.duplicateHandling = mode;
	subject.saveSourceId = true;
	await subject.ready;
	return subject;
}

function coreContext(vault: MemoryVault, ctx: ImportContext, client: unknown): DatabaseProcessingContext {
	return {
		ctx, currentPageFolderPath: OUTPUT, client: client as never,
		vault: vault as never, app: memoryApp(vault), outputRootPath: OUTPUT,
		formulaStrategy: 'hybrid', processedDatabases: new Map(), relationPlaceholders: [],
		databaseLookups: createDatabaseLookups(),
		importPageCallback: async () => {},
	};
}

const wrapperBlock = {
	id: ids.wrapper, type: 'child_database', has_children: false,
	child_database: { title: 'Untitled' },
} as never;

function clientFor(graph: ReturnType<typeof graphFor>, ctx: ImportContext) {
	const requests: { method: string, args: any }[] = [];
	const unexpected: unknown[] = [];
	const methods: Record<string, (args: any) => unknown> = {
		'databases.retrieve': args => {
			assert.deepEqual(Object.keys(args), ['database_id']);
			assert.ok(graph.databases[args.database_id], `unknown database ${args.database_id}`);
			return graph.databases[args.database_id];
		},
		'dataSources.retrieve': args => {
			assert.deepEqual(args, { data_source_id: ids.source });
			return graph.source;
		},
		'dataSources.query': args => {
			assert.deepEqual(args, { data_source_id: ids.source, start_cursor: undefined, page_size: 100 });
			return { object: 'list', results: graph.rows, has_more: false, next_cursor: null };
		},
		'dataSources.listTemplates': args => {
			assert.deepEqual(args, { data_source_id: ids.source });
			return { templates: [], has_more: false, next_cursor: null };
		},
		'views.list': () => ({ results: [], has_more: false, next_cursor: null }),
		'blocks.children.list': args => {
			assert.deepEqual(Object.keys(args).sort(), ['block_id', 'page_size', 'start_cursor']);
			assert.equal(args.page_size, 100);
			assert.equal(args.start_cursor, undefined);
			assert.ok(graph.blocks[args.block_id], `unknown block ${args.block_id}`);
			return graph.blocks[args.block_id];
		},
	};
	// Unknown calls must fail even if the importer catches their exception.
	function call(method: string, args: any) {
		requests.push({ method, args });
		try {
			assert.ok(methods[method], `unknown method ${method}`);
			return Promise.resolve(structuredClone(methods[method](args)));
		}
		catch (error) {
			unexpected.push(error);
			ctx.cancel();
			throw error;
		}
	}
	const branch = (prefix: string): any => new Proxy(() => {}, {
		get: (_target, key) => key === 'then' ? undefined : branch(prefix ? `${prefix}.${String(key)}` : String(key)),
		apply: (_target, _this, args) => call(prefix, args[0]),
	});
	return { client: branch(''), requests, unexpected };
}

async function outputVault() {
	const vault = new FolderAwareVault();
	await vault.createFolder(OUTPUT);
	return vault;
}

async function setup(view: View) {
	const vault = await outputVault();
	const ctx = new ImportContext();
	return { vault, ctx, mock: clientFor(graphFor(view), ctx) };
}

function requested(mock: ReturnType<typeof clientFor>, method: string) {
	return mock.requests.filter(request => request.method === method).map(request => request.args);
}

answerRequests(request => { throw new Error(`unexpected HTTP request: ${request.url}`); });

for (const entry of ['database-id', 'data-source-id'] as const) for (const view of ['ordinary', 'shared-source', 'empty-source'] as const) {
	test(`${entry} / ${view}: one canonical Base and complete, uniquely identified notes`, async () => {
		const { vault, ctx, mock } = await setup(view);
		const subject = await importerFor(vault);
		await subject.importGraph(ctx, mock.client, entry);

		assert.deepEqual(mock.unexpected, []);
		assert.deepEqual(ctx.failed, []);
		assert.equal(ctx.isCancelled(), false);
		assert.equal(ctx.notes, 3);
		const paths = vault.paths().sort();
		const notes = paths.filter(path => path.endsWith('.md')).map(path => {
			const content = String(vault.contents.get(path));
			const id = new RegExp(`^${NOTION_ID_PROPERTY}: (.+)$`, 'm').exec(content)?.[1];
			return { path, id, content };
		});
		assert.deepEqual(notes.map(note => note.id).sort(), pages.map(page => page.id).sort());
		for (const page of pages) {
			assert.ok(notes.find(note => note.id === page.id)?.content.includes(page.body));
		}
		const bases = paths.filter(path => path.endsWith('.base'));
		assert.equal(requested(mock, 'dataSources.query').length, 1);
		assert.equal(requested(mock, 'dataSources.retrieve').length, 1);
		assert.equal(requested(mock, 'blocks.children.list').length, 3);
		const retrieved = requested(mock, 'databases.retrieve').map(args => args.database_id);
		assert.deepEqual(retrieved, [...new Set(retrieved)], 'each database is retrieved once');
		assert.equal(notes.find(note => note.id === ids.album)?.content.includes(UNSUPPORTED), view !== 'ordinary');
		assert.deepEqual(bases, [BASE], 'one canonical Base, with no duplicate database structure');
		// A linked view writes nothing, so the row holding it stays a plain note.
		for (const page of pages) {
			assert.equal(notes.find(note => note.id === page.id)?.path, `${OUTPUT}/Projects/${page.title}.md`);
		}
		assert.ok(!vault.getAllLoadedFiles().some(file => file.path.endsWith('/Untitled')));
	});
}

test('a linked view is skipped the same way before and after its owner is imported', async () => {
	const { vault, ctx, mock } = await setup('shared-source');
	const context = coreContext(vault, ctx, mock.client);

	assert.equal(await convertChildDatabase(wrapperBlock, context), UNSUPPORTED);
	assert.deepEqual(vault.paths(), []);
	assert.equal(context.processedDatabases.size, 0);
	assert.equal(requested(mock, 'dataSources.query').length, 0);

	await importDatabaseCore(ids.root, context);
	const before = mock.requests.length;
	assert.equal(await convertChildDatabase(wrapperBlock, context), UNSUPPORTED);
	assert.equal(context.processedDatabases.has(ids.wrapper), false);
	assert.equal(mock.requests.length, before, 'the view and its source are already known');
	assert.deepEqual(vault.paths(), [BASE]);
	assert.deepEqual(mock.unexpected, []);
	assert.deepEqual(ctx.failed, []);
});

for (const entry of ['database-id', 'data-source-id'] as const) {
	test(`${entry}: a row that reaches its own database while it imports does not start it again`, async () => {
		const { vault, ctx, mock } = await setup('ordinary');
		const context = coreContext(vault, ctx, mock.client);
		let rows = 0;
		context.importPageCallback = async () => {
			assert.ok(++rows <= pages.length, 'the database was imported a second time');
			await importDatabaseCore(ids.root, context);
			await importDatabaseCore(ids.source, context, true);
		};

		if (entry === 'database-id') await importDatabaseCore(ids.root, context);
		else await importDatabaseCore(ids.source, context, true);

		assert.equal(rows, pages.length);
		assert.equal(requested(mock, 'dataSources.query').length, 1);
		assert.equal(requested(mock, 'databases.retrieve').length, entry === 'database-id' ? 1 : 0);
		assert.equal(context.processedDatabases.get(ids.root), context.processedDatabases.get(ids.source));
		assert.deepEqual(vault.paths(), [BASE]);
		assert.deepEqual(mock.unexpected, []);
	});
}

for (const view of ['shared-source', 'empty-source'] as const) {
	test(`${view}: a linked view inside a synced block is marked as linked, not as inaccessible`, async () => {
		const { vault, ctx, mock } = await setup(view);
		const synced = `${OUTPUT}/Synced.md`;
		await vault.create(synced, `Before\n\n${createPlaceholder(PlaceholderType.SYNCED_CHILD_DATABASE, ids.wrapper)}\n`);
		await (await importerFor(vault)).resolveSyncedDatabase(ctx, mock.client, synced, ids.wrapper);

		assert.equal(vault.contents.get(synced), `Before\n\n${UNSUPPORTED}\n`);
		assert.deepEqual(vault.paths(), [synced]);
		assert.deepEqual(mock.unexpected, []);
		assert.deepEqual(ctx.failed, []);
	});
}

test('a data source that reports no owner is still imported once', async () => {
	const vault = await outputVault();
	const ctx = new ImportContext();
	const graph = graphFor('ordinary');
	delete (graph.source as { parent?: unknown }).parent;
	const mock = clientFor(graph, ctx);
	const context = coreContext(vault, ctx, mock.client);

	await importDatabaseCore(ids.source, context, true);
	await importDatabaseCore(ids.root, context);

	assert.equal(requested(mock, 'dataSources.query').length, 1);
	assert.equal(context.processedDatabases.get(ids.root), context.processedDatabases.get(ids.source));
	assert.deepEqual(vault.paths(), [BASE]);
	assert.deepEqual(mock.unexpected, []);
});

test('distinct data sources with an Untitled database name are both imported', async () => {
	const vault = await outputVault();
	const imported: string[] = [];
	const graph = graphFor('ordinary');
	const sourceFor = (databaseId: string) => databaseId === ids.root ? ids.source : ids.wrapper;
	const client = {
		databases: { retrieve: async ({ database_id }: { database_id: string }) => ({
			title: [richText('Untitled')], data_sources: [{ id: sourceFor(database_id) }],
		}) },
		dataSources: {
			retrieve: async ({ data_source_id }: { data_source_id: string }) => ({
				...graph.source, id: data_source_id,
				parent: { type: 'database_id', database_id: data_source_id === ids.source ? ids.root : ids.album },
			}),
			query: async ({ data_source_id }: { data_source_id: string }) => {
				imported.push(data_source_id);
				return { results: [], has_more: false, next_cursor: null };
			},
			listTemplates: async () => ({ templates: [] }),
		},
	};
	const context = coreContext(vault, new ImportContext(), client);
	await importDatabaseCore(ids.root, context);
	context.currentPageFolderPath = 'Notion/Other';
	await vault.createFolder(context.currentPageFolderPath);
	await importDatabaseCore(ids.album, context);
	assert.deepEqual(imported, [ids.source, ids.wrapper]);
	assert.deepEqual(vault.paths().sort(), ['Notion/Other/Untitled/Untitled.base', 'Notion/Untitled/Untitled.base']);
});

test('an owner ID without dashes still matches the source parent', async () => {
	const vault = await outputVault();
	const ctx = new ImportContext();
	const graph = graphFor('ordinary');
	const id = ids.root.replace(/-/g, '');
	graph.databases[id] = graph.databases[ids.root];
	const mock = clientFor(graph, ctx);
	await importDatabaseCore(id, coreContext(vault, ctx, mock.client));
	assert.deepEqual(vault.paths(), [BASE]);
	assert.deepEqual(mock.unexpected, []);
});

for (const mode of [DuplicateHandling.Skip, DuplicateHandling.Update]) {
	test(`${mode} reimport restores a deleted row without expanding the wrapper`, async () => {
		const vault = await outputVault();
		const firstCtx = new ImportContext();
		const firstMock = clientFor(graphFor('shared-source'), firstCtx);
		await (await importerFor(vault, mode)).importGraph(firstCtx, firstMock.client, 'data-source-id');
		vault.remove('Notion/Projects/Photo B.md');

		const ctx = new ImportContext();
		const mock = clientFor(graphFor('shared-source'), ctx);
		await (await importerFor(vault, mode)).importGraph(ctx, mock.client, 'data-source-id');
		assert.equal(ctx.notes, 1);
		assert.equal(ctx.skipped.length, 2);
		assert.deepEqual(ctx.failed, []);
		assert.equal(requested(mock, 'dataSources.query').length, 1);
		assert.deepEqual(requested(mock, 'blocks.children.list').map(args => args.block_id), [ids.photo], 'only the missing row is read again');
		assert.deepEqual(vault.paths().filter(path => path.endsWith('.base')), [BASE]);
		assert.ok(vault.contents.get('Notion/Projects/Photo B.md')?.toString().includes(pages[1].body));
		assert.deepEqual(mock.unexpected, []);
	});
}
