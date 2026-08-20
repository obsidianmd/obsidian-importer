import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderNoteTemplate } from '../../src/note-template';

test('renders variables, nested values, and missing values', () => {
	assert.equal(renderNoteTemplate(
		'{{title}} — {{properties.created}} — {{missing}}',
		{ title: 'A note', properties: { created: '2026-08-20' } },
	), 'A note — 2026-08-20 — ');
});

test('applies Web Clipper-style text and array filters', () => {
	assert.equal(renderNoteTemplate(
		'{{ title | trim | upper }} / {{ tags | unique | join:" + " }} / {{ value | replace:"a":"x" }}',
		{ title: '  Mixed case  ', tags: ['one', 'two', 'one'], value: 'banana' },
	), 'MIXED CASE / one + two / bxnxnx');
});

test('formats and modifies dates', () => {
	assert.equal(renderNoteTemplate(
		'{{published|date:"YYYY/MM/DD"}} {{published|date_modify:"+2 days"}}',
		{ published: '2026-08-20T12:30:00Z' },
	), '2026/08/20 2026-08-22');
});

test('resolves exact variable names before treating dots as nested paths', () => {
	assert.equal(renderNoteTemplate('{{First name}} / {{field.with.dots}}', {
		'First name': 'Ada',
		'field.with.dots': 'kept whole',
	}), 'Ada / kept whole');
});
