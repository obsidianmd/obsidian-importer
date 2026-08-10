import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { en } from '../../src/i18n/en';
import { locales } from '../../src/i18n/locales';
import { camelToKebab, decodeNewlines, encodeNewlines, flatten, interpolate, parseLocale, stringifyLocale } from '../../src/i18n/util';
import { i18n, setLanguage } from '../../src/i18n';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a nested key flattens to the path a translation file uses', () => {
	const flat = flatten({ output: { nameSaveSourceId: 'Save {{label}}' } });

	assert.deepEqual(flat, { 'output.name-save-source-id': 'Save {{label}}' });
});

test('a plural variant keeps its underscore', () => {
	assert.equal(camelToKebab('noteWithCount_plural'), 'note-with-count_plural');
});

test('a placeholder is filled from the values it was given', () => {
	assert.equal(interpolate('Import from {{format}}', { format: 'Bear' }), 'Import from Bear');
});

test('a placeholder with nothing to fill it is left as it is', () => {
	assert.equal(interpolate('Import from {{format}}', {}), 'Import from {{format}}');
});

test('a newline survives the round trip through a translation file', () => {
	const text = 'First line\nSecond line, with a \\ in it';

	assert.equal(encodeNewlines(text), 'First line\\nSecond line, with a \\\\ in it');
	assert.equal(decodeNewlines(encodeNewlines(text)), text);
});

test('an untranslated block contributes nothing, so English still shows', () => {
	const bundle = parseLocale([
		'[modal.button-done]',
		'original=Done',
		'translation=Terminé',
		'',
		'[modal.button-back]',
		'original=Back',
		'translation=',
	].join('\n'));

	assert.deepEqual(bundle, { 'modal.button-done': 'Terminé' });
});

test('a translation file is written in the block format translators edit', () => {
	const written = stringifyLocale({ 'modal.button-done': 'Done' }, { 'modal.button-done': 'Terminé' });

	assert.equal(written, '[modal.button-done]\noriginal=Done\ntranslation=Terminé\n');
});

test('the lookup reads English until a language is chosen', () => {
	assert.equal(i18n.modal.buttonDone(), en.modal.buttonDone);
});

test('a language the build does not carry falls back to English', () => {
	setLanguage('xx');
	assert.equal(i18n.modal.buttonDone(), en.modal.buttonDone);
	setLanguage('en');
});

test('a regional code falls back to its base language', () => {
	const [key, translated] = Object.entries(locales['fr'])[0];

	setLanguage('fr-CA');
	assert.equal(i18n(key), translated);
	setLanguage('en');
});

test('a count of anything but one takes the plural variant', () => {
	assert.equal(i18n.nouns.fileWithCount({ count: 1 }), '1 file');
	assert.equal(i18n.nouns.fileWithCount({ count: 0 }), '0 files');
	assert.equal(i18n.nouns.fileWithCount({ count: 7 }), '7 files');
});

test('a key can be reached from its section at runtime', () => {
	assert.equal(i18n.importer('notion.name'), en.importer.notion.name);
});

test('a key no language has resolves to itself rather than to nothing', () => {
	assert.equal(i18n.modal('no-such-key'), 'modal.no-such-key');
});

test('every translation is for a key the English table still has', () => {
	const keys = new Set(Object.keys(flatten(en)));

	for (const [language, bundle] of Object.entries(locales)) {
		for (const key of Object.keys(bundle)) {
			assert.ok(keys.has(key), `${language} translates ${key}, which no longer exists`);
		}
	}
});

test('a translation carries the same placeholders as its English', () => {
	const english = flatten(en);
	const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

	for (const [language, bundle] of Object.entries(locales)) {
		for (const [key, translated] of Object.entries(bundle)) {
			assert.deepEqual(
				placeholders(translated),
				placeholders(english[key]),
				`${language} changed the placeholders in ${key}`
			);
		}
	}
});

test('a string with a plural form has one in every language that translates it', () => {
	const english = flatten(en);

	for (const [language, bundle] of Object.entries(locales)) {
		for (const key of Object.keys(bundle)) {
			if (key.endsWith('_plural') || english[key + '_plural'] === undefined) continue;

			assert.ok(
				bundle[key + '_plural'] !== undefined,
				`${language} translates ${key} but not its plural, so a count would show in English`
			);
		}
	}
});

test('the translation files and the bundled locale data match src/i18n/en.ts', () => {
	const result = spawnSync(path.join(root, 'node_modules', '.bin', 'tsx'), ['scripts/locales.ts', 'check'], {
		cwd: root,
		encoding: 'utf8',
	});

	assert.equal(result.status, 0, result.stderr);
});

test('en.txt offers a block for every string, and translates none of them', () => {
	const text = readFileSync(path.join(root, 'locale', 'en.txt'), 'utf8');

	assert.equal(Object.keys(parseLocale(text)).length, 0);
	assert.equal((text.match(/^\[/gm) ?? []).length, Object.keys(flatten(en)).length);
});
