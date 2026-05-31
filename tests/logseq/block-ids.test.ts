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
