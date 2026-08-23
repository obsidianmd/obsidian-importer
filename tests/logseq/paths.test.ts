import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeLogseqName, namespaceToPath } from '../../src/formats/logseq/paths';


test('decodeLogseqName decodes a simple percent-escape', () => {
	assert.equal(decodeLogseqName('Encoded%3AColon'), 'Encoded:Colon');
});

test('decodeLogseqName decodes multi-byte UTF-8 escapes', () => {
	assert.equal(decodeLogseqName('caf%C3%A9'), 'café');
});

test('decodeLogseqName leaves plain text unchanged', () => {
	assert.equal(decodeLogseqName('Cool Stuff'), 'Cool Stuff');
});

test('decodeLogseqName does not change triple underscore', () => {
	assert.equal(decodeLogseqName('a___b'), 'a___b');
});

test('decodeLogseqName leaves malformed %ZZ unchanged but decodes valid parts', () => {
	assert.equal(decodeLogseqName('a%ZZb%3Ac'), 'a%ZZb:c');
});

test('decodeLogseqName leaves a lone %2 (too short) unchanged', () => {
	assert.equal(decodeLogseqName('100%2 done'), '100%2 done');
});

test('decodeLogseqName leaves a trailing bare percent unchanged', () => {
	assert.equal(decodeLogseqName('50%'), '50%');
});

test('decodeLogseqName handles empty string', () => {
	assert.equal(decodeLogseqName(''), '');
});

test('decodeLogseqName decodes adjacent escapes correctly', () => {
	assert.equal(decodeLogseqName('%3A%3A'), '::');
});


test('namespaceToPath splits on triple underscore', () => {
	assert.equal(namespaceToPath('algorithms___dynamic programming'), 'algorithms/dynamic programming');
});

test('namespaceToPath splits multiple triple-underscore separators', () => {
	assert.equal(namespaceToPath('a___b___c'), 'a/b/c');
});

test('namespaceToPath splits on percent-encoded slash', () => {
	assert.equal(namespaceToPath('foo%2Fbar'), 'foo/bar');
});

test('namespaceToPath decodes a single segment with no separator', () => {
	assert.equal(namespaceToPath('Encoded%3AColon'), 'Encoded:Colon');
});

test('namespaceToPath leaves a plain title unchanged', () => {
	assert.equal(namespaceToPath('Cool Stuff'), 'Cool Stuff');
});

test('namespaceToPath does not split on single underscore', () => {
	assert.equal(namespaceToPath('foo_bar'), 'foo_bar');
});

test('namespaceToPath does not split on single slash', () => {
	assert.equal(namespaceToPath('foo/bar'), 'foo/bar');
});

test('namespaceToPath decodes each namespace segment', () => {
	assert.equal(namespaceToPath('Encoded%3AColon___notes'), 'Encoded:Colon/notes');
});

test('namespaceToPath prefers %2F over ___ when both present', () => {
	assert.equal(namespaceToPath('a%2Fb___c'), 'a/b___c');
});

test('namespaceToPath handles empty string', () => {
	assert.equal(namespaceToPath(''), '');
});

test('namespaceToPath preserves leading separator as empty segment', () => {
	assert.equal(namespaceToPath('___a'), '/a');
});

test('namespaceToPath preserves trailing separator as empty segment', () => {
	assert.equal(namespaceToPath('a___'), 'a/');
});

test('namespaceToPath leaves malformed percent untouched in segment', () => {
	assert.equal(namespaceToPath('a%ZZ___b'), 'a%ZZ/b');
});


// Mirrors the sanitizer without importing its Obsidian dependency.
function stripBrackets(name: string): string {
	return name.replace(/\[/g, '').replace(/\]/g, '');
}

test('[F1] namespaced page with [[brackets]] in the name yields a bracket-free folder path', () => {
	const basename = 'Team A___feedback___[[Alice]]\'s experience';
	const path = stripBrackets(namespaceToPath(basename));
	assert.equal(path, 'Team A/feedback/Alice\'s experience');
	assert.ok(!path.includes('['));
	assert.ok(!path.includes(']'));
});
