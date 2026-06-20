import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHtmlImportTitle, extractZohoNotecardName } from '../../src/formats/html-title';

function htmlWithNotecard(dataNotecard: string | null): HTMLElement {
	return {
		querySelector(selector: string) {
			assert.equal(selector, 'body');
			return {
				getAttribute(name: string) {
					assert.equal(name, 'data-notecard');
					return dataNotecard;
				},
			};
		},
	} as unknown as HTMLElement;
}

test('uses the Zoho notecard name as the HTML import title', () => {
	const title = extractHtmlImportTitle(htmlWithNotecard('{"name":"Vietnam"}'), '9j1oe6413f84cc35f');

	assert.equal(title, 'Vietnam');
});

test('trims Zoho notecard names before using them', () => {
	assert.equal(extractZohoNotecardName('{"name":"  Travel Notes  "}'), 'Travel Notes');
});

test('falls back to the source filename when Zoho metadata is unavailable', () => {
	assert.equal(extractHtmlImportTitle(htmlWithNotecard(null), '9j1oe6413f84cc35f'), '9j1oe6413f84cc35f');
});

test('falls back to the source filename when Zoho metadata is malformed', () => {
	assert.equal(extractHtmlImportTitle(htmlWithNotecard('{bad json'), '9j1oe6413f84cc35f'), '9j1oe6413f84cc35f');
});

test('falls back to the source filename when the Zoho name is blank', () => {
	assert.equal(extractHtmlImportTitle(htmlWithNotecard('{"name":"   "}'), '9j1oe6413f84cc35f'), '9j1oe6413f84cc35f');
});

test('falls back to the source filename when the Zoho name is not a string', () => {
	assert.equal(extractHtmlImportTitle(htmlWithNotecard('{"name":42}'), '9j1oe6413f84cc35f'), '9j1oe6413f84cc35f');
});
