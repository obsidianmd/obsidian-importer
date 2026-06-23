import { test } from 'node:test';
import assert from 'node:assert/strict';

import { indexPageAliases, isBodyEmpty } from '../../src/formats/logseq/pipeline';

// ---------------------------------------------------------------------------
// indexAliases
// ---------------------------------------------------------------------------

test('indexAliases: registers a single alias', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({ alias: 'Foo Bar' }, 'pages/foo-bar', aliasMap, ambiguous);
	assert.equal(aliasMap.get('foo bar'), 'pages/foo-bar');
	assert.equal(ambiguous.size, 0);
});

test('indexAliases: registers multiple comma-separated aliases', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({ alias: 'Foo, Bar' }, 'pages/foo', aliasMap, ambiguous);
	assert.equal(aliasMap.get('foo'), 'pages/foo');
	assert.equal(aliasMap.get('bar'), 'pages/foo');
});

test('indexAliases: strips [[...]] wikilink syntax from alias values', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({ aliases: '[[My Page]]' }, 'pages/my-page', aliasMap, ambiguous);
	assert.equal(aliasMap.get('my page'), 'pages/my-page');
});

test('indexAliases: registers title:: as an additional alias', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({ title: 'My Custom Title' }, 'pages/my-page', aliasMap, ambiguous);
	assert.equal(aliasMap.get('my custom title'), 'pages/my-page');
});

test('indexAliases: registers both alias and title properties', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({ alias: 'Short Name', title: 'Long Title' }, 'pages/page', aliasMap, ambiguous);
	assert.equal(aliasMap.get('short name'), 'pages/page');
	assert.equal(aliasMap.get('long title'), 'pages/page');
});

test('indexAliases: marks conflicting aliases as ambiguous', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({ alias: 'Shared' }, 'pages/page-a', aliasMap, ambiguous);
	indexPageAliases({ alias: 'Shared' }, 'pages/page-b', aliasMap, ambiguous);
	assert.ok(ambiguous.has('shared'));
});

test('indexAliases: skips empty raw (no alias, no title)', () => {
	const aliasMap = new Map<string, string>();
	const ambiguous = new Set<string>();
	indexPageAliases({}, 'pages/page', aliasMap, ambiguous);
	assert.equal(aliasMap.size, 0);
	assert.equal(ambiguous.size, 0);
});

// ---------------------------------------------------------------------------
// isBodyEmpty
// ---------------------------------------------------------------------------

test('isBodyEmpty: true when yaml and body are both empty', () => {
	assert.ok(isBodyEmpty('', ''));
});

test('isBodyEmpty: true when yaml is empty and body is only whitespace', () => {
	assert.ok(isBodyEmpty('', '   \n\n  '));
});

test('isBodyEmpty: false when body has content', () => {
	assert.ok(!isBodyEmpty('', '- some content'));
});

test('isBodyEmpty: false when yaml is present (even with empty body)', () => {
	assert.ok(!isBodyEmpty('---\naliases:\n  - Foo\n---', ''));
});

test('isBodyEmpty: false when both yaml and body have content', () => {
	assert.ok(!isBodyEmpty('---\ntags:\n  - area\n---', '- note content'));
});

test('[T7] empty page after pass-2 is skipped', () => {
	// A body that becomes empty after conversion (e.g. only whitespace remains)
	// is reported as empty so the orchestrator can skip writing it.
	assert.ok(isBodyEmpty('', '\n  \n'));
	assert.ok(!isBodyEmpty('', '- still here'));
});
