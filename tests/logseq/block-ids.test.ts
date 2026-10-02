import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shortenId, attachBlockIds, resolveBlockRefs, BlockRefTarget } from '../../src/formats/logseq/block-ids';

const UUID = '64ab9aa4-459a-41b1-8c21-dbb38dc0c79b';

test('shortenId takes the leading hex of a UUID', () => {
	assert.equal(shortenId(UUID), '64ab9a');
});

test('attachBlockIds appends a shortened anchor and drops the id line', () => {
	const input = ['- a block', `  id:: ${UUID}`, '- other'].join('\n');
	const { content, ids } = attachBlockIds(input);
	assert.equal(content, ['- a block ^64ab9a', '- other'].join('\n'));
	assert.deepEqual(ids, [{ uuid: UUID, shortId: '64ab9a', text: 'a block' }]);
});

test('attachBlockIds handles an id written as its own bullet', () => {
	const input = ['- Paragraph line', '- id:: abc123', '- See more'].join('\n');
	const { content, ids } = attachBlockIds(input);
	assert.equal(content, ['- Paragraph line ^abc123', '- See more'].join('\n'));
	assert.deepEqual(ids, [{ uuid: 'abc123', shortId: 'abc123', text: 'Paragraph line' }]);
});

test('attachBlockIds disambiguates colliding short ids within a file', () => {
	const a = 'abcdef12-0000-0000-0000-000000000000';
	const b = 'abcdef34-0000-0000-0000-000000000000';
	const input = ['- one', `  id:: ${a}`, '- two', `  id:: ${b}`].join('\n');
	const { content, ids } = attachBlockIds(input);
	assert.equal(content, ['- one ^abcdef', '- two ^abcdef-1'].join('\n'));
	assert.deepEqual(ids, [
		{ uuid: a, shortId: 'abcdef', text: 'one' },
		{ uuid: b, shortId: 'abcdef-1', text: 'two' },
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

test('[G1] resolveBlockRefs preserves refs inside a fenced code block', () => {
	const index = new Map<string, BlockRefTarget>([['abc123', { page: 'P', shortId: 'abc123' }]]);
	const input = ['```', '{{embed ((abc123))}} and ((abc123))', '```'].join('\n');
	assert.equal(resolveBlockRefs(input, index), input);
});

test('[G1] resolveBlockRefs leaves unresolved refs inside a fenced code block inert', () => {
	const index = new Map<string, BlockRefTarget>();
	const input = ['```', '{{embed ((abc123))}} and ((abc123))', '```'].join('\n');
	assert.equal(resolveBlockRefs(input, index), input);
});

test('[G1] resolveBlockRefs leaves refs inside an inline code span inert', () => {
	const index = new Map<string, BlockRefTarget>([['u1', { page: 'P', shortId: 'abc' }]]);
	assert.equal(resolveBlockRefs('`((u1))`', index), '`((u1))`');
});

test('[G1] attachBlockIds places the anchor after a code block, not on the fence', () => {
	const input = ['- ```', '  code', '  ```', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input);
	assert.equal(content, ['- ```', '  code', '  ```', '  ^abc123'].join('\n'));
});

test('[G1] attachBlockIds preserves id-like syntax inside tilde fences', () => {
	const input = ['- ~~~markdown', '  id:: abc123', '  ((abc123))', '  ~~~'].join('\n');
	const { content, ids } = attachBlockIds(input);
	assert.equal(content, input);
	assert.deepEqual(ids, []);
});

test('[G1] attachBlockIds places the anchor on its own line for a plain heading block', () => {
	const input = ['# Tasks', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input);
	assert.equal(content, ['# Tasks', '^abc123'].join('\n'));
});

test('[G1] attachBlockIds places an indented anchor below a bullet-heading block', () => {
	const input = ['- ## Section', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input);
	assert.equal(content, ['- ## Section', '  ^abc123'].join('\n'));
});

test('[G1] attachBlockIds anchors after a retained block property line', () => {
	const input = ['- text', '  kept:: v', '  id:: abc123'].join('\n');
	const { content } = attachBlockIds(input);
	assert.equal(content, ['- text', '  kept:: v ^abc123'].join('\n'));
});

function indexOf(text: string): Map<string, BlockRefTarget> {
	return new Map<string, BlockRefTarget>([[UUID, { page: 'Foo', shortId: '64ab9a', text }]]);
}

test('attachBlockIds records the first line of a multiline block', () => {
	const input = ['- first line', '  second line', '  kept:: v', `  id:: ${UUID}`].join('\n');
	assert.equal(attachBlockIds(input).ids[0].text, 'first line');
});

test('resolveBlockRefs shows the referenced block as the link text', () => {
	assert.equal(resolveBlockRefs(`see ((${UUID}))`, indexOf('a block')), 'see [[Foo#^64ab9a|a block]]');
});

test('resolveBlockRefs reduces block markup to plain link text', () => {
	const cases: [string, string][] = [
		['done **well**', 'done well'],
		['see [[Page|shown]] and [[Other]] and [site](https://example.com)', 'see shown and Other and site'],
		['![[image.png]] ==marked== `code` {{cloze hidden}} {{renderer x}}', 'marked code hidden'],
		['a | b [c]', 'a b c'],
	];
	for (const [text, shown] of cases) {
		assert.equal(resolveBlockRefs(`((${UUID}))`, indexOf(text)), `[[Foo#^64ab9a|${shown}]]`);
	}
});

test('resolveBlockRefs omits link text for a block with no prose', () => {
	assert.equal(resolveBlockRefs(`((${UUID}))`, indexOf('')), '[[Foo#^64ab9a]]');
	assert.equal(resolveBlockRefs(`((${UUID}))`, indexOf('![[image.png]]')), '[[Foo#^64ab9a]]');
});

test('resolveBlockRefs shortens long link text at a word boundary', () => {
	const resolved = resolveBlockRefs(`((${UUID}))`, indexOf('word '.repeat(40)));
	assert.equal(resolved, `[[Foo#^64ab9a|${'word '.repeat(20).trim()}…]]`);
});

test('resolveBlockRefs uses the text of a reference nested in the block', () => {
	const index = new Map<string, BlockRefTarget>([
		['aaa111', { page: 'A', shortId: 'aaa111', text: 'inner' }],
		['bbb222', { page: 'B', shortId: 'bbb222', text: 'outer ((aaa111))' }],
		['ccc333', { page: 'C', shortId: 'ccc333', text: 'labelled [here](((aaa111)))' }],
	]);
	assert.equal(resolveBlockRefs('((bbb222))', index), '[[B#^bbb222|outer inner]]');
	assert.equal(resolveBlockRefs('((ccc333))', index), '[[C#^ccc333|labelled here]]');
});

test('resolveBlockRefs stops at blocks that reference each other', () => {
	const index = new Map<string, BlockRefTarget>([
		['aaa111', { page: 'A', shortId: 'aaa111', text: 'one ((bbb222))' }],
		['bbb222', { page: 'B', shortId: 'bbb222', text: 'two ((aaa111))' }],
	]);
	assert.equal(resolveBlockRefs('((aaa111))', index), '[[A#^aaa111|one two]]');
});

test('resolveBlockRefs keeps the label of a labelled block reference', () => {
	assert.equal(resolveBlockRefs(`[my **label**](((${UUID})))`, indexOf('a block')), '[[Foo#^64ab9a|my label]]');
	assert.equal(resolveBlockRefs('[label](((unknownuuid)))', indexOf('a block')), '[label](((unknownuuid)))');
});

test('attachBlockIds records no text for a code block', () => {
	const bulleted = ['- ```yaml', '  - secret', '  ```', `  id:: ${UUID}`].join('\n');
	assert.equal(attachBlockIds(bulleted).ids[0].text, '');
	const bare = ['- before', '```', 'code', '```', `id:: ${UUID}`].join('\n');
	assert.equal(attachBlockIds(bare).ids[0].text, '');
});

test('attachBlockIds keeps the text of a block that continues into a fence', () => {
	const input = ['- intro', '  ```', '  - item', '  ```', `  id:: ${UUID}`].join('\n');
	assert.equal(attachBlockIds(input).ids[0].text, 'intro');
});

test('attachBlockIds records block text without its markers', () => {
	const cases: [string, string][] = [
		['- [x] done **well**', 'done **well**'],
		['  1. ## A heading', 'A heading'],
		['> [!note] Title', 'Title'],
	];
	for (const [line, text] of cases) {
		assert.equal(attachBlockIds([line, `id:: ${UUID}`].join('\n')).ids[0].text, text);
	}
});

test('resolveBlockRefs repeats the text of a block referenced twice', () => {
	const index = new Map<string, BlockRefTarget>([
		['aaa111', { page: 'A', shortId: 'aaa111', text: 'inner' }],
		['bbb222', { page: 'B', shortId: 'bbb222', text: '((aaa111)) and ((aaa111))' }],
	]);
	assert.equal(resolveBlockRefs('((bbb222))', index), '[[B#^bbb222|inner and inner]]');
});

test('resolveBlockRefs keeps a reference written as inline code in the block text', () => {
	const index = new Map<string, BlockRefTarget>([
		['aaa111', { page: 'A', shortId: 'aaa111', text: 'real text' }],
		['bbb222', { page: 'B', shortId: 'bbb222', text: 'Literal `((aaa111))` syntax' }],
	]);
	assert.equal(resolveBlockRefs('((bbb222))', index), '[[B#^bbb222|Literal ((aaa111)) syntax]]');
});

test('resolveBlockRefs stops expanding deeply nested references', () => {
	const index = new Map<string, BlockRefTarget>([['b0', { page: 'P', shortId: 'b0', text: 'end' }]]);
	for (let i = 1; i <= 40; i++) {
		index.set(`b${i}`, { page: 'P', shortId: `b${i}`, text: `${i} ((b${i - 1})) ((b${i - 1}))` });
	}
	assert.equal(resolveBlockRefs('((b40))', index), '[[P#^b40|40 39 38 37 37 38 37 37 39 38 37 37 38 37 37]]');
	assert.equal(resolveBlockRefs('((b2))', index), '[[P#^b2|2 1 end end 1 end end]]');
});

test('resolveBlockRefs keeps inline code in the label of a labelled block reference', () => {
	assert.equal(resolveBlockRefs(`[my \`label\`](((${UUID})))`, indexOf('a block')), '[[Foo#^64ab9a|my label]]');
	assert.equal(resolveBlockRefs(`\`[my label](((${UUID})))\``, indexOf('a block')), `\`[my label](((${UUID})))\``);
	const index = new Map<string, BlockRefTarget>([
		['aaa111', { page: 'A', shortId: 'aaa111', text: 'inner' }],
		['bbb222', { page: 'B', shortId: 'bbb222', text: 'see [the \`x\`](((aaa111)))' }],
	]);
	assert.equal(resolveBlockRefs('((bbb222))', index), '[[B#^bbb222|see the x]]');
});

test('resolveBlockRefs leaves reference syntax shown in a label alone', () => {
	const index = new Map<string, BlockRefTarget>([
		['aaa111', { page: 'P', shortId: 'aaa111', text: 'inner' }],
		['bbb222', { page: 'P', shortId: 'bbb222', text: 'outer' }],
	]);
	assert.equal(
		resolveBlockRefs('[the `((aaa111))` syntax](((bbb222))) then ((aaa111))', index),
		'[[P#^bbb222|the ((aaa111)) syntax]] then [[P#^aaa111|inner]]');
});
