import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeListProperties } from '../../src/list-properties';
import { renderNoteTemplate } from '../../src/note-template';
import { parseFrontMatterBlock } from '../../src/util';

test('registers Knap standard filters', async () => {
	assert.equal(await renderNoteTemplate(
		'{{ title | trim | upper }} / {{published|date:"YYYY/MM/DD"}}',
		{ title: '  Mixed case  ', published: '2026-08-20T12:30:00Z' },
	), 'MIXED CASE / 2026/08/20');
});

test('renders CSV values as YAML scalars', async () => {
	assert.equal(await renderNoteTemplate(
		[
			'Name: {{name | yaml}}',
			'Count: {{count | yaml}}',
			'Complete: {{complete | yaml}}',
			'Project: {{source["Project: status"] | yaml}}',
			'Empty: {{empty | yaml}}',
			'Spaces: {{spaces | yaml}}',
			'Zip: {{zip | yaml}}',
			'SKU: {{sku | yaml}}',
			'Exponent: {{exponent | yaml}}',
		].join('\n'),
		{
			name: 'A: value #1',
			count: '42',
			complete: 'true',
			empty: '',
			spaces: ' ',
			zip: '007',
			sku: '0x1F',
			exponent: '1e5',
			source: { 'Project: status': 'Ready' },
		},
	), [
		'Name: "A: value #1"',
		'Count: 42',
		'Complete: true',
		'Project: "Ready"',
		'Empty: ""',
		'Spaces: " "',
		'Zip: "007"',
		'SKU: "0x1F"',
		'Exponent: "1e5"',
	].join('\n'));
});

test('normalizes Obsidian list properties after rendering', async () => {
	const rendered = await renderNoteTemplate(
		[
			'---',
			'Tags: {{tags | yaml}}',
			'Aliases: {{aliases | yaml}}',
			'cssclasses: {{classes | yaml}}',
			'Other: {{other | yaml}}',
			'---',
		].join('\n'),
		{
			tags: '[#travel, #wishlist, 007]',
			aliases: '[Don\'t, "Doe, John", Note: draft, 007]',
			classes: 'wide, dashboard compact',
			other: '[007, 2024]',
		},
	);
	const parsed = parseFrontMatterBlock(normalizeListProperties(rendered));
	assert.deepEqual(parsed?.frontMatter, {
		Tags: ['travel', 'wishlist', '007'],
		Aliases: ["Don't", 'Doe, John', 'Note: draft', '007'],
		cssclasses: ['wide', 'dashboard', 'compact'],
		Other: '[007, 2024]',
	});
});

test('leaves empty Obsidian list properties byte-identical', () => {
	const content = [
		'---',
		'Title: "Empty lists"',
		'tags:',
		'aliases:',
		'cssclasses:',
		'---',
		'Body',
	].join('\n');

	assert.equal(normalizeListProperties(content), content);
});

test('resolves exact variable names before treating dots as nested paths', async () => {
	assert.equal(await renderNoteTemplate('{{First name}} / {{field.with.dots}}', {
		'First name': 'Ada',
		'field.with.dots': 'kept whole',
	}), 'Ada / kept whole');
});

test('supports the application-provided Markdown filter', async () => {
	assert.equal(await renderNoteTemplate(
		'{{html | markdown}}',
		{ html: '<p>Hello <strong>world</strong></p>' },
	), 'Hello **world**');
});

test('renders Markdown with an imported page URL in context', async () => {
	assert.equal(await renderNoteTemplate(
		'{{html | markdown}}',
		{
			html: '<a href="/docs">Documentation</a>',
			url: 'https://example.com/article',
		},
	), '[Documentation](/docs)');
});

test('accepts an explicit Markdown base URL parameter', async () => {
	assert.equal(await renderNoteTemplate(
		'{{html | markdown:"https://example.com/reference/"}}',
		{ html: '<a href="page">Page</a>' },
	), '[Page](page)');
});

test('passes an imported page URL to fragment links', async () => {
	assert.equal(await renderNoteTemplate(
		'{{selection | fragment_link}}',
		{
			selection: '"Selected text"',
			url: 'https://example.com/article',
		},
	), 'Selected text [link](https://example.com/article#:~:text=Selected%20text)');
});

test('surfaces non-fatal Knap filter warnings', async (t) => {
	const warn = t.mock.method(console, 'warn', () => undefined);

	assert.equal(await renderNoteTemplate(
		'{{value|replace:"/[/":"x"}}',
		{ value: 'a[b' },
	), 'a[b');
	assert.equal(warn.mock.callCount(), 1);
	assert.match(String(warn.mock.calls[0]?.arguments[1]), /filter replace/u);
});
