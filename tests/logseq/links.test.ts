import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAliasLinks, convertTags, rewriteAliasReferences } from '../../src/formats/logseq/links';

// --- alias links: [display]([[Page]]) -> [[Page|display]] ---
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

// --- tags ---
test('keeps simple tags but sanitizes multi-word tags (keep-as-tag mode)', () => {
	assert.equal(convertTags('a #tag b', false), 'a #tag b');
	assert.equal(convertTags('x #[[multi word]] y', false), 'x #multi-word y');
});

test('converts tags to wikilinks when requested', () => {
	assert.equal(convertTags('a #tag b', true), 'a [[tag]] b');
	assert.equal(convertTags('x #[[multi word]] y', true), 'x [[multi word]] y');
});

test('does not treat a mid-word hash as a tag', () => {
	assert.equal(convertTags('color #fff and C#', true), 'color [[fff]] and C#');
});

// --- alias references: rewrite [[Alias]] -> [[Canonical|Alias]] ---
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
