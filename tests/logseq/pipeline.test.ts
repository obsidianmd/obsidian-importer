import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertLocal } from '../../src/formats/logseq/pipeline';
import { DEFAULT_LOGSEQ_OPTIONS } from '../../src/formats/logseq/options';

const opts = DEFAULT_LOGSEQ_OPTIONS;

test('extracts frontmatter and converts a simple page body', () => {
	const input = ['title:: My Page', 'tags:: a, b', '', '- TODO do it', '- a note ^^highlight^^'].join('\n');
	const { yaml, body, raw } = convertLocal(input, opts);
	assert.equal(yaml, ['---', 'aliases:', '  - My Page', 'tags:', '  - a', '  - b', '---'].join('\n'));
	assert.equal(raw.title, 'My Page');
	assert.equal(body, ['- [ ] do it', '- a note ==highlight=='].join('\n'));
});

test('task with a block id attaches the anchor after task conversion', () => {
	const input = ['- TODO important', '  id:: abcdef12-0000-0000-0000-000000000000'].join('\n');
	const { body, ids } = convertLocal(input, opts);
	assert.equal(body, '- [ ] important ^abcdef');
	assert.deepEqual(ids, [{ uuid: 'abcdef12-0000-0000-0000-000000000000', shortId: 'abcdef' }]);
});

test('numbered list and leftover property cleanup run together', () => {
	const input = [
		'- one',
		'  logseq.order-list-type:: number',
		'- two',
		'  logseq.order-list-type:: number',
		'- plain',
		'  collapsed:: true',
	].join('\n');
	const { body } = convertLocal(input, opts);
	assert.equal(body, ['1. one', '2. two', '- plain'].join('\n'));
});

test('collects assets referenced by the page', () => {
	const input = '- ![pic](../assets/image.png)';
	const { body, assets } = convertLocal(input, opts);
	assert.equal(body, '- ![[image.png]]');
	assert.deepEqual(assets, [{ sourcePath: '../assets/image.png', filename: 'image.png' }]);
});

test('scheduled task metadata is rendered (emoji default)', () => {
	const input = ['- TODO pay rent', '  SCHEDULED: <2024-09-01 Sun>'].join('\n');
	const { body } = convertLocal(input, opts);
	assert.equal(body, '- [ ] pay rent ⏳ 2024-09-01');
});

test('does not transform documented Logseq syntax inside Markdown code', () => {
	const input = [
		'- Logseq syntax:',
		'  ~~~markdown',
		'  - TODO [#A] write the docs',
		'    SCHEDULED: <2024-06-15 Sat>',
		'    heading:: 2',
		'    key:: value',
		'    logseq.order-list-type:: number',
		'  ~~~',
	].join('\n');
	assert.equal(convertLocal(input, opts).body, input);
});

test('preserves inline-code spacing and keeps task metadata attached', () => {
	const input = [
		'- Run `npm test` before you push.',
		'- TODO update `README.md`',
		'  SCHEDULED: <2024-06-15 Sat>',
		'- The `id::` property marks a block.',
	].join('\n');
	const expected = [
		'- Run `npm test` before you push.',
		'- [ ] update `README.md` ⏳ 2024-06-15',
		'- The `id::` property marks a block.',
	].join('\n');
	assert.equal(convertLocal(input, opts).body, expected);
});
