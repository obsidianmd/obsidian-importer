/**
 * What a Notion database row becomes, outside Obsidian.
 *
 * A relation carries page ids and nothing else, so what a note ends up saying
 * for one depends on whether the page it points at is being imported. The
 * fixture has both: Sequel points inside the imported data source, Director
 * points at one the user did not select.
 *
 * Recorded here is the frontmatter each row produces, which is where the ids
 * land. Turning them into links is the importer's second pass and needs a
 * vault, so it is stood in for the same way the Airtable conversion stands in
 * for its own.
 *
 * tests/notion-api/live.test.ts checks these shapes against the real API.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { stringifyYaml } from 'obsidian';

import { extractFrontMatter, extractPageTitle } from '../../src/formats/notion-api/api-helpers';
import { DATABASE_PAGE_PREFETCH, importDatabasePages, processRelationProperties, replaceRelationValue, yamlScalar } from '../../src/formats/notion-api/database-helpers';
import { ImportContext } from '../../src/import-context';
import type { RelationPlaceholder } from '../../src/formats/notion-api/types';
import { expectFile, expectedFor, type Fixture } from '../helpers';

const FIXTURE: Fixture = { name: 'example-database.json', path: nodePath.join(__dirname, 'example-database.json'), local: false };

interface DatabaseFixture {
	dataSourceId: string;
	title: string;
	properties: Record<string, any>;
	rows: any[];
	/** Pages a relation points at that the import is not writing, by id. */
	relatedPages: Record<string, any>;
}

const fixture = JSON.parse(nodeFs.readFileSync(FIXTURE.path, 'utf8')) as DatabaseFixture;

test('database rows read a window ahead but import in order', async () => {
	const total = DATABASE_PAGE_PREFETCH + 3;
	const pages = Array.from({ length: total }, (_, index) => ({
		object: 'page',
		id: `row-${index}`,
		properties: {},
	})) as never[];
	const requested: string[] = [];
	const requestedWhenImported: string[][] = [];
	const imported: string[] = [];
	const client = {
		blocks: {
			children: {
				list: async ({ block_id }: { block_id: string }) => {
					requested.push(block_id);
					return { results: [], has_more: false, next_cursor: null };
				},
			},
		},
	} as never;

	await importDatabasePages(
		pages,
		client,
		new ImportContext(),
		'Notion/Database',
		'Database.base',
		async (pageId, parentPath, databaseTag, customFileName, page, blocks) => {
			requestedWhenImported.push([...requested]);
			assert.equal(parentPath, 'Notion/Database');
			assert.equal(databaseTag, 'Database.base');
			assert.equal(customFileName, undefined);
			assert.equal(page, pages[Number(pageId.slice(4))]);
			assert.deepEqual(await blocks, []);
			imported.push(pageId);
		},
	);

	const row = (index: number) => `row-${index}`;
	assert.deepEqual(imported, Array.from({ length: total }, (_, index) => row(index)));

	assert.deepEqual(
		requestedWhenImported,
		Array.from({ length: total }, (_, index) =>
			Array.from(
				{ length: Math.min(index + DATABASE_PAGE_PREFETCH, total) },
				(_, ahead) => row(ahead),
			)),
	);
	assert.equal(requestedWhenImported[0].length, DATABASE_PAGE_PREFETCH);
	assert.deepEqual(requested, Array.from({ length: total }, (_, index) => row(index)));
});

test('the fixture has a relation that stays in the import and one that leaves it', () => {
	const relations = Object.entries(fixture.properties).filter(([, p]) => p.type === 'relation');
	assert.equal(relations.length, 2, 'expected two relation properties');

	const targets = new Set(relations.map(([, p]) => p.relation.data_source_id));
	assert.ok(targets.has(fixture.dataSourceId), 'one relation should point inside the import');
	assert.equal(targets.size, 2, 'the other should point at a data source that is not being imported');
});

/**
 * The importer's second pass, which runs once every page has a path.
 *
 * A relation pointing at an imported page becomes a link to it. One pointing
 * anywhere else becomes that page's title, which the importer reads with
 * GET /v1/pages/{id} - the fixture's relatedPages stand in for those calls.
 *
 * The rewriting itself is the importer's own replaceRelationValue rather than a
 * copy of it, so the two cannot say different things.
 */
function resolveRelations(
	content: string,
	relatedPageIds: string[],
	propertyKey: string,
	pathForPage: Map<string, string>
): string {
	const replacements = new Map<string, string>();

	for (const pageId of relatedPageIds) {
		const path = pathForPage.get(pageId);
		if (path) {
			const name = path.slice(path.lastIndexOf('/') + 1);
			replacements.set(pageId, `[[${path}|${name}]]`);
			continue;
		}

		const page = fixture.relatedPages[pageId];
		if (page) replacements.set(pageId, extractPageTitle(page as never));
	}

	return replaceRelationValue(content, propertyKey, replacements);
}

test('converts the database rows', async () => {
	// What the import writes notes for: the two Movies rows, and nothing in
	// the Directors data source the user did not select
	const pathForPage = new Map(fixture.rows.map(page =>
		[page.id as string, `Notion/Movies/${extractPageTitle(page as never)}`]));

	const placeholders: RelationPlaceholder[] = [];
	await processRelationProperties(fixture.rows, fixture.properties, placeholders);

	const notes: string[] = [];

	for (const page of fixture.rows) {
		const frontMatter = await extractFrontMatter({
			page,
			databaseProperties: fixture.properties,
		});

		// One pass per relation property, as the importer does it
		let resolved = `---\n${stringifyYaml(frontMatter)}---`;
		for (const placeholder of placeholders.filter(p => p.pageId === page.id)) {
			resolved = resolveRelations(resolved, placeholder.relatedPageIds, placeholder.propertyKey, pathForPage);
		}

		notes.push(`${extractPageTitle(page)}\n${resolved.replace(/^---\n|---$/g, '')}`);
	}

	expectFile(notes.join('\n'), expectedFor(FIXTURE, 'example-database.md'), FIXTURE.name);
});

test('every relation is recorded for the second pass', async () => {
	const placeholders: RelationPlaceholder[] = [];
	await processRelationProperties(fixture.rows, fixture.properties, placeholders);

	// Both rows link out, and the first also links within the import
	assert.deepEqual(placeholders.map(p => p.propertyKey).sort(), ['Director', 'Director', 'Sequel']);

	const leaving = placeholders.filter(p => p.propertyKey === 'Director');
	for (const placeholder of leaving) {
		assert.equal(placeholder.targetDatabaseId, '22222222-2222-2222-2222-222222222222');
		for (const id of placeholder.relatedPageIds) {
			assert.ok(fixture.relatedPages[id], `the fixture should carry the page ${id} points at`);
		}
	}
});

test('the pages a relation leaves the import for have titles to use', () => {
	// What the fix has to reach for: a page the import is not writing still has
	// a name, and GET /v1/pages/{id} is where it comes from
	assert.deepEqual(
		Object.values(fixture.relatedPages).map(page => extractPageTitle(page as never)),
		['Ada Lovelace', 'Grace Hopper']
	);
});

/**
 * The rewriting on its own.
 *
 * A relation carries a bare UUID rather than a token of the importer's own, so
 * what stops it being replaced somewhere it did not mean is the property it is
 * scoped to.
 */
const NOTE = [
	'---',
	'notion-id: aaaaaaaa-0000-0000-0000-000000000001',
	'Director:',
	'  - bbbbbbbb-0000-0000-0000-000000000001',
	'Sequel:',
	'  - aaaaaaaa-0000-0000-0000-000000000001',
	'---',
	'',
	'Notes on aaaaaaaa-0000-0000-0000-000000000001, which is this page.',
].join('\n');

test('rewrites only the property the relation belongs to', () => {
	const rewritten = replaceRelationValue(NOTE, 'Director',
		new Map([['bbbbbbbb-0000-0000-0000-000000000001', 'Ada Lovelace']]));

	assert.match(rewritten, /Director:\n {2}- Ada Lovelace/);
	// Everything else is where it was
	assert.match(rewritten, /notion-id: aaaaaaaa-0000-0000-0000-000000000001/);
	assert.match(rewritten, /Notes on aaaaaaaa-0000-0000-0000-000000000001, which is this page\./);
});

test('a page that relates to itself keeps its own notion-id', () => {
	const rewritten = replaceRelationValue(NOTE, 'Sequel',
		new Map([['aaaaaaaa-0000-0000-0000-000000000001', '[[Notion/Movies/This one|This one]]']]));

	// The id is the page's own as well as the one it relates to, and only the
	// relation is a link
	assert.match(rewritten, /notion-id: aaaaaaaa-0000-0000-0000-000000000001/);
	assert.match(rewritten, /Sequel:\n {2}- "\[\[Notion\/Movies\/This one\|This one\]\]"/);
	assert.match(rewritten, /Notes on aaaaaaaa-0000-0000-0000-000000000001, which is this page\./);
});

test('a relation already resolved is left as it is', () => {
	const once = replaceRelationValue(NOTE, 'Director',
		new Map([['bbbbbbbb-0000-0000-0000-000000000001', 'Ada Lovelace']]));

	assert.equal(replaceRelationValue(once, 'Director',
		new Map([['bbbbbbbb-0000-0000-0000-000000000001', 'Ada Lovelace']])), once);
});

test('a name that needs quoting gets them, and one that does not stays plain', () => {
	assert.equal(yamlScalar('Ada Lovelace'), 'Ada Lovelace');
	assert.equal(yamlScalar('[[Notion/Movies/Tron|Tron]]'), '"[[Notion/Movies/Tron|Tron]]"');
	assert.equal(yamlScalar('Notes: on quoting'), '"Notes: on quoting"');
	assert.equal(yamlScalar('1984'), '"1984"');
});
