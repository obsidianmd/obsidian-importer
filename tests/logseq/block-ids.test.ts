import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shortenId, attachBlockIds, resolveBlockRefs, removeOrphanBlockRefs, BlockRefTarget } from '../../src/formats/logseq/block-ids';

const UUID = '64ab9aa4-459a-41b1-8c21-dbb38dc0c79b';

test('shortenId takes the leading hex of a UUID', () => {
	assert.equal(shortenId(UUID), '64ab9a');
});

test('attachBlockIds appends a shortened anchor and drops the id line', () => {
	const input = ['- a block', `  id:: ${UUID}`, '- other'].join('\n');
	const { content, ids } = attachBlockIds(input, true);
	assert.equal(content, ['- a block ^64ab9a', '- other'].join('\n'));
	assert.deepEqual(ids, [{ uuid: UUID, shortId: '64ab9a' }]);
});

test('attachBlockIds handles an id written as its own bullet', () => {
	// Logseq sometimes flattens a block property onto its own bullet line.
	const input = ['- Paragraph line', '- id:: abc123', '- See more'].join('\n');
	const { content, ids } = attachBlockIds(input, true);
	assert.equal(content, ['- Paragraph line ^abc123', '- See more'].join('\n'));
	assert.deepEqual(ids, [{ uuid: 'abc123', shortId: 'abc123' }]);
});

test('attachBlockIds can keep the full UUID', () => {
	const input = ['- a block', `  id:: ${UUID}`].join('\n');
	const { content, ids } = attachBlockIds(input, false);
	assert.equal(content, `- a block ^${UUID}`);
	assert.deepEqual(ids, [{ uuid: UUID, shortId: UUID }]);
});

test('attachBlockIds disambiguates colliding short ids within a file', () => {
	const a = 'abcdef12-0000-0000-0000-000000000000';
	const b = 'abcdef34-0000-0000-0000-000000000000';
	const input = ['- one', `  id:: ${a}`, '- two', `  id:: ${b}`].join('\n');
	const { content, ids } = attachBlockIds(input, true);
	assert.equal(content, ['- one ^abcdef', '- two ^abcdef-1'].join('\n'));
	assert.deepEqual(ids, [
		{ uuid: a, shortId: 'abcdef' },
		{ uuid: b, shortId: 'abcdef-1' },
	]);
});

test('resolveBlockRefs rewrites block references to wikilink anchors', () => {
	const index = new Map<string, BlockRefTarget>([[UUID, { page: 'Foo', shortId: '64ab9a' }]]);
	assert.equal(resolveBlockRefs(`see ((${UUID}))`, index), 'see [[Foo#^64ab9a]]');
});

test('resolveBlockRefs rewrites block and page embeds', () => {
	const index = new Map<string, BlockRefTarget>([[UUID, { page: 'Foo', shortId: '64ab9a' }]]);
	assert.equal(resolveBlockRefs(`{{embed ((${UUID}))}}`, index), '![[Foo#^64ab9a]]');
	assert.equal(resolveBlockRefs('{{embed [[Bar]]}}', index), '![[Bar]]');
});

test('resolveBlockRefs leaves unresolved references untouched', () => {
	const index = new Map<string, BlockRefTarget>();
	assert.equal(resolveBlockRefs('((unknownuuid))', index), '((unknownuuid))');
});

// --- removeOrphanBlockRefs ---
test('removeOrphanBlockRefs strips unresolved ((uuid)) references', () => {
	assert.equal(removeOrphanBlockRefs('see ((abc123)) here'), 'see  here');
});

test('removeOrphanBlockRefs strips unresolved {{embed ((uuid))}} embeds', () => {
	assert.equal(removeOrphanBlockRefs('- {{embed ((abc123))}}').trim(), '');
});

test('removeOrphanBlockRefs leaves already-resolved [[Page#^id]] links untouched', () => {
	assert.equal(removeOrphanBlockRefs('see [[Foo#^abc123]]'), 'see [[Foo#^abc123]]');
});

test('removeOrphanBlockRefs leaves page embeds untouched', () => {
	assert.equal(removeOrphanBlockRefs('![[SomePage]]'), '![[SomePage]]');
});

// ---------------------------------------------------------------------------
// Regression findings (domain 02) — RED tests for accepted fixes.
// (BR-5 reformatIsoDateLinks is a internal orchestrator method, BR-8 always-embed
//  needs a new option, BR-6/BR-7 are covered by existing tests / e2e — those are
//  written in the fix phase, not here.)
// ---------------------------------------------------------------------------

// BR-1: refs/embeds inside code regions must stay inert (currently resolved).
test('[BR-1] resolveBlockRefs leaves refs inside a fenced code block inert', () => {
	const index = new Map<string, BlockRefTarget>([['u1', { page: 'P', shortId: 'abc' }]]);
	const input = ['```', '{{embed ((u1))}} and ((u1))', '```'].join('\n');
	assert.equal(resolveBlockRefs(input, index), input);
});

test('[BR-1] resolveBlockRefs leaves refs inside an inline code span inert', () => {
	const index = new Map<string, BlockRefTarget>([['u1', { page: 'P', shortId: 'abc' }]]);
	assert.equal(resolveBlockRefs('`((u1))`', index), '`((u1))`');
});

// BR-2: a block whose last line is a closing ``` fence must get its anchor on a
// new line, not appended to the fence (which makes an invalid CommonMark close).
test('[BR-2] attachBlockIds places the anchor after a code block, not on the fence', () => {
	const input = ['- ```', '  code', '  ```', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['- ```', '  code', '  ```', '  ^abc123'].join('\n'));
});

// BR-3: a heading block must get its anchor on its own line below the heading,
// not appended to the heading text (where Obsidian renders it as literal text).
test('[BR-3] attachBlockIds places the anchor on its own line for a heading block', () => {
	const input = ['# Tasks', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['# Tasks', '', '^abc123'].join('\n'));
});

// BR-4: anchor must land on the block's true last line, after retained block
// properties (currently it lands on the content line above them).
test('[BR-4] attachBlockIds anchors after a retained block property line', () => {
	const input = ['- text', '  kept:: v', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['- text', '  kept:: v ^abc123'].join('\n'));
});
