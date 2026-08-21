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
