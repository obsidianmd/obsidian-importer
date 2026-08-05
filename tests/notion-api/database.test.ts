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
import { processRelationProperties } from '../../src/formats/notion-api/database-helpers';
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
 * anywhere else is left as the id: the importer first tries to import the
 * whole database it points into, and this is where that lands when it cannot -
 * an integration that was never shared that part of the workspace, a cancelled
 * import, or the round limit.
 *
 * Mirrors replaceRelationPlaceholders in notion-api.ts: only the ids that page
 * actually relates to are replaced, and each is replaced wherever it appears in
 * the file rather than only in its property.
 */
function resolveRelations(
	content: string,
	relatedPageIds: string[],
	pathForPage: Map<string, string>
): string {
	let resolved = content;

	for (const pageId of relatedPageIds) {
		const path = pathForPage.get(pageId);
		if (!path) continue;

		const name = path.slice(path.lastIndexOf('/') + 1);
		resolved = resolved.replace(new RegExp(pageId, 'g'), `"[[${path}|${name}]]"`);
	}

	return resolved;
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

		const relatedPageIds = placeholders
			.filter(placeholder => placeholder.pageId === page.id)
			.flatMap(placeholder => placeholder.relatedPageIds);

		notes.push(`${extractPageTitle(page)}\n${resolveRelations(stringifyYaml(frontMatter), relatedPageIds, pathForPage)}`);
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
