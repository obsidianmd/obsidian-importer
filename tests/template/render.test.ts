import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderNoteTemplate } from '../../src/note-template';

test('renders variables, nested values, and missing values', async () => {
	assert.equal(await renderNoteTemplate(
		'{{title}} — {{properties.created}} — {{missing}}',
		{ title: 'A note', properties: { created: '2026-08-20' } },
	), 'A note — 2026-08-20 — ');
});

test('applies shared text and array filters', async () => {
	assert.equal(await renderNoteTemplate(
		'{{ title | trim | upper }} / {{ tags | unique | join:" + " }} / {{ value | replace:"a":"x" }}',
		{ title: '  Mixed case  ', tags: ['one', 'two', 'one'], value: 'banana' },
	), 'MIXED CASE / one + two / bxnxnx');
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

test('formats and modifies dates', async () => {
	assert.equal(await renderNoteTemplate(
		'{{published|date:"YYYY/MM/DD"}} {{published|date_modify:"+2 days"}}',
		{ published: '2026-08-20T12:30:00Z' },
	), '2026/08/20 2026-08-22');
});

test('resolves exact variable names before treating dots as nested paths', async () => {
	assert.equal(await renderNoteTemplate('{{First name}} / {{field.with.dots}}', {
		'First name': 'Ada',
		'field.with.dots': 'kept whole',
	}), 'Ada / kept whole');
});

test('supports shared template logic', async () => {
	assert.equal(await renderNoteTemplate(
		'{% if tags %}{% for tag in tags %}- {{tag | upper}}{% endfor %}{% else %}No tags{% endif %}',
		{ tags: ['one', 'two'] },
	), '- ONE\n- TWO');
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
