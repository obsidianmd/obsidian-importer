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
// Documented transformation cases — G1.
// Date-link reformatting is covered in journals.test.ts against E1.
// ---------------------------------------------------------------------------

// G1: refs/embeds inside code fences ARE resolved when the UUID is known.
// Logseq embed syntax is unambiguous; converted form is more useful in Obsidian
// (e.g. code blocks used as copy-pasteable examples should show the resolved link).
// Inline-code spans are still protected.
test('[G1] resolveBlockRefs resolves refs inside a fenced code block when UUID is known', () => {
	const index = new Map<string, BlockRefTarget>([['abc123', { page: 'P', shortId: 'abc123' }]]);
	const input = ['```', '{{embed ((abc123))}} and ((abc123))', '```'].join('\n');
	const expected = ['```', '![[P#^abc123]] and [[P#^abc123]]', '```'].join('\n');
	assert.equal(resolveBlockRefs(input, index), expected);
});

test('[G1] resolveBlockRefs leaves unresolved refs inside a fenced code block inert', () => {
	const index = new Map<string, BlockRefTarget>(); // empty index
	const input = ['```', '{{embed ((abc123))}} and ((abc123))', '```'].join('\n');
	assert.equal(resolveBlockRefs(input, index), input);
});

test('[G1] resolveBlockRefs leaves refs inside an inline code span inert', () => {
	const index = new Map<string, BlockRefTarget>([['u1', { page: 'P', shortId: 'abc' }]]);
	assert.equal(resolveBlockRefs('`((u1))`', index), '`((u1))`');
});

// G1: a block whose last line is a closing ``` fence must get its anchor on a
// new line, not appended to the fence (which makes an invalid CommonMark close).
test('[G1] attachBlockIds places the anchor after a code block, not on the fence', () => {
	const input = ['- ```', '  code', '  ```', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['- ```', '  code', '  ```', '  ^abc123'].join('\n'));
});

// G1: a heading block must get its anchor on its own line below the heading,
// not appended to the heading text (where Obsidian renders it as literal text
// and prevents referencing the heading by content alone).
test('[G1] attachBlockIds places the anchor on its own line for a plain heading block', () => {
	// No blank line between heading and anchor — anchor must stay adjacent.
	const input = ['# Tasks', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['# Tasks', '^abc123'].join('\n'));
});

test('[G1] attachBlockIds places an indented anchor below a bullet-heading block', () => {
	// In Logseq, headings are always bullet items. The anchor must be indented
	// at content level (same indent as the id:: line) so it stays part of the block.
	const input = ['- ## Section', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['- ## Section', '  ^abc123'].join('\n'));
});

// G1: anchor must land on the block's true last line, after retained block
// properties (currently it lands on the content line above them).
test('[G1] attachBlockIds anchors after a retained block property line', () => {
	const input = ['- text', '  kept:: v', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input, true);
	assert.equal(content, ['- text', '  kept:: v ^abc123'].join('\n'));
});

// G1: alwaysEmbedBlockRefs option — bare ((uuid)) refs become ![[Page#^id]]
// (embed) instead of [[Page#^id]] (link).
test('[G1] resolveBlockRefs converts bare refs to embeds when alwaysEmbedBlockRefs is on', () => {
	const index = new Map<string, BlockRefTarget>([[UUID, { page: 'Foo', shortId: '64ab9a' }]]);
	assert.equal(
		resolveBlockRefs(`see ((${UUID}))`, index, { alwaysEmbedBlockRefs: true }),
		'see ![[Foo#^64ab9a]]',
	);
});

test('[G1] resolveBlockRefs keeps embed syntax unchanged when alwaysEmbedBlockRefs is on', () => {
	const index = new Map<string, BlockRefTarget>([[UUID, { page: 'Foo', shortId: '64ab9a' }]]);
	// {{embed ((uuid))}} already produces ![[...]], option has no extra effect
	assert.equal(
		resolveBlockRefs(`{{embed ((${UUID}))}}`, index, { alwaysEmbedBlockRefs: true }),
		'![[Foo#^64ab9a]]',
	);
});

test('[G1] resolveBlockRefs default behaviour unchanged (link not embed)', () => {
	const index = new Map<string, BlockRefTarget>([[UUID, { page: 'Foo', shortId: '64ab9a' }]]);
	assert.equal(resolveBlockRefs(`see ((${UUID}))`, index), 'see [[Foo#^64ab9a]]');
});
