/**
 * The kanban views a Notion database's boards become in its base.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { createDatabaseLookups } from '../../src/formats/notion-api/api-helpers';
import { importDatabaseCore } from '../../src/formats/notion-api/database-helpers';
import { ImportContext } from '../../src/import-context';
import { expectFile, expectedFor, type Fixture } from '../helpers';
import { MemoryVault, memoryApp } from '../shims/vault';

const FIXTURE: Fixture = { name: 'board-views.json', path: nodePath.join(__dirname, 'board-views.json'), local: false };
const fixture = JSON.parse(nodeFs.readFileSync(FIXTURE.path, 'utf8'));

async function importBase(kanban: boolean): Promise<{ base: string, viewRequests: number }> {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	let viewRequests = 0;

	const client = {
		dataSources: {
			retrieve: async () => ({
				name: fixture.title,
				properties: fixture.properties,
				parent: { type: 'database_id', database_id: fixture.databaseId },
			}),
			query: async () => ({ results: fixture.rows, has_more: false, next_cursor: null }),
			listTemplates: async () => ({ templates: [] }),
		},
		views: {
			list: async ({ database_id }: { database_id: string }) => {
				viewRequests++;
				assert.equal(database_id, fixture.databaseId);
				return { results: fixture.views.map((view: { id: string }) => ({ object: 'view', id: view.id })), has_more: false, next_cursor: null };
			},
			retrieve: async ({ view_id }: { view_id: string }) => {
				viewRequests++;
				return fixture.views.find((view: { id: string }) => view.id === view_id);
			},
		},
	};

	const { baseFilePath } = await importDatabaseCore(fixture.dataSourceId, {
		ctx: new ImportContext(),
		currentPageFolderPath: 'Notion',
		client: client as never,
		vault: vault as never,
		app: Object.assign(memoryApp(vault), {
			metadataTypeManager: { getAssignedWidget: () => null, setType: () => {} },
		}) as never,
		outputRootPath: 'Notion',
		formulaStrategy: 'hybrid',
		processedDatabases: new Map(),
		databaseLookups: createDatabaseLookups(),
		relationPlaceholders: [],
		importPageCallback: async () => {},
		kanban,
	}, true);

	return { base: await vault.read({ path: baseFilePath }), viewRequests };
}

test('each board becomes a kanban view', async () => {
	const { base } = await importBase(true);
	expectFile(base, expectedFor(FIXTURE, 'board-views.base'), FIXTURE.name);
});

test('an app without kanban views is not asked for them', async () => {
	const { base, viewRequests } = await importBase(false);
	assert.equal(viewRequests, 0);
	assert.doesNotMatch(base, /kanban/);
});
