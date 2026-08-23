import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAliasLinks, convertTags, rewriteAliasReferences, rewritePlannedPageLinks } from '../../src/formats/logseq/links';

test('converts Logseq page-alias links', () => {
	assert.equal(convertAliasLinks('[label]([[Page]])'), '[[Page|label]]');
	assert.equal(convertAliasLinks('see [My Note]([[Some/Page]]) here'), 'see [[Some/Page|My Note]] here');
});

test('leaves plain wikilinks and normal markdown links untouched', () => {
	assert.equal(convertAliasLinks('[[Page]]'), '[[Page]]');
	assert.equal(convertAliasLinks('[text](https://example.com)'), '[text](https://example.com)');
});

test('does not convert alias links inside fenced code', () => {
	const input = ['```', '[label]([[Page]])', '```'].join('\n');
	assert.equal(convertAliasLinks(input), input);
});

test('does not convert alias links inside inline code or tilde fences', () => {
	const input = ['`[label]([[Page]])`', '~~~', '[label]([[Page]])', '~~~'].join('\n');
	assert.equal(convertAliasLinks(input), input);
});

test('keeps simple tags but sanitizes multi-word tags', () => {
	assert.equal(convertTags('a #tag b'), 'a #tag b');
	assert.equal(convertTags('x #[[multi word]] y'), 'x #multi-word y');
	assert.equal(convertTags('x #[[research & notes]] y'), 'x #research-notes y');
});

test('drops listed tags from body text', () => {
	const dropped = new Set(['card', 'my-tag']);
	assert.equal(convertTags('a #card b', dropped), 'a  b');
	assert.equal(convertTags('a #[[my tag]] b', dropped), 'a  b');
});

test('rewrites a reference that targets an alias', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('[[ML]]', index), '[[Machine Learning|ML]]');
});

test('keeps an explicit display when rewriting an alias reference', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('[[ML|the model]]', index), '[[Machine Learning|the model]]');
});

test('rewrites embeds that target an alias', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('![[ML]]', index), '![[Machine Learning|ML]]');
});

test('leaves canonical names and unknown targets untouched', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('[[Machine Learning]]', index), '[[Machine Learning]]');
	assert.equal(rewriteAliasReferences('[[Something Else]]', index), '[[Something Else]]');
});

test('does not rewrite block or heading references', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('[[ML#^abc123]]', index), '[[ML#^abc123]]');
});


test('[G1] does not rewrite an alias reference inside inline code', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('use `[[ML]]` here', index), 'use `[[ML]]` here');
});

test('[G1] does not rewrite a link when the alias equals the page name', () => {
	const index = { aliasMap: new Map([['same page', 'Same Page']]) };
	assert.equal(rewriteAliasReferences('[[Same Page]]', index), '[[Same Page]]');
});

test('[M1] rewrites a source page name to its planned path', () => {
	const plans = new Map([['feedback', { target: 'Logseq/feedback 1', display: 'feedback' }]]);
	assert.equal(rewritePlannedPageLinks('[[feedback]]', plans), '[[Logseq/feedback 1|feedback]]');
});

test('rewrites a namespaced source page name to its planned path', () => {
	const plans = new Map([['algorithms/dynamic programming', { target: 'Logseq/algorithms/dynamic programming' }]]);
	assert.equal(
		rewritePlannedPageLinks('[[algorithms___dynamic programming]]', plans),
		'[[Logseq/algorithms/dynamic programming]]',
	);
});

test('[G1] alias link with piped target does not produce a double pipe', () => {
	assert.equal(convertAliasLinks('[disp]([[A|B]])'), '[[A|disp]]');
});

test('a non-ASCII tag can be dropped by name', () => {
	const dropped = new Set(['café', 'हिन्दी', 'cafe\u0301']);
	assert.equal(convertTags('a #café b', dropped), 'a  b');
	assert.equal(convertTags('a #हिन्दी b', dropped), 'a  b');
	assert.equal(convertTags('a #cafe\u0301 b', dropped), 'a  b');
});
