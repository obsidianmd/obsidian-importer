/**
 * The shim against the app.
 *
 * These are not tests of the importers - they check that what the shim writes
 * is what Obsidian writes, which every recording depends on. The expected
 * values here came from the app, by round-tripping the same input through
 * processFrontMatter; see CLAUDE.md for how to redo that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as yaml from 'yaml';

import { stringifyYaml } from './obsidian';

test('writes YAML the way Obsidian does', () => {
	const written = stringifyYaml({
		date: '2023-12-17',
		datetime: '2024-06-01T12:30:00.000Z',
		time: '12:30',
		numberish: '007',
		boolish: 'true',
		yes: 'yes',
		plain: 'hello',
		colon: 'a: b',
		list: ['2019-03-14', 'plain'],
		num: 42,
		real: 18.99,
		bool: true,
		nul: null,
	});

	// Byte for byte what the app produced for the same object
	assert.equal(written, [
		'date: 2023-12-17',
		'datetime: 2024-06-01T12:30:00.000Z',
		'time: 12:30',
		'numberish: "007"',
		'boolish: "true"',
		'yes: yes',
		'plain: hello',
		'colon: "a: b"',
		'list:',
		'  - 2019-03-14',
		'  - plain',
		'num: 42',
		'real: 18.99',
		'bool: true',
		'nul:',
		'',
	].join('\n'));
});

test('quotes the way Obsidian does', () => {
	// Round-tripped through processFrontMatter in the app, which quotes less
	// than might be expected: a value with a double quote in it is single
	// quoted, and one with both kinds is not quoted at all.
	const written = stringifyYaml({
		aliases: ['Notes: on "quoting" / naming'],
		single: 'it\'s got an apostrophe',
		both: 'has "double" and \'single\'',
		colon: 'a: b',
		backslash: 'a \\ b',
		plain: 'hello',
	});

	assert.equal(written, [
		'aliases:',
		'  - \'Notes: on "quoting" / naming\'',
		'single: it\'s got an apostrophe',
		'both: has "double" and \'single\'',
		'colon: "a: b"',
		'backslash: a \\ b',
		'plain: hello',
		'',
	].join('\n'));
});

test('leaves the inside of a multi-line value alone', () => {
	// The quoting and null rules are applied line by line, and a block
	// scalar's lines are its value rather than YAML
	const value = { note: 'line one\nfoo: null\nquoted: \'x\'\nend', ok: null };

	assert.deepEqual(yaml.parse(stringifyYaml(value)), value);
});
