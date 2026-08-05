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

import * as yaml from 'js-yaml';

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

test('leaves the inside of a multi-line value alone', () => {
	// The quoting and null rules are applied line by line, and a block
	// scalar's lines are its value rather than YAML
	const value = { note: 'line one\nfoo: null\nquoted: \'x\'\nend', ok: null };

	assert.deepEqual(yaml.load(stringifyYaml(value)), value);
});
