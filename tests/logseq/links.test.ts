import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAliasLinks, convertTags, rewriteAliasReferences, rewritePlannedPageLinks } from '../../src/formats/logseq/links';

// Helper: build ConvertTagsOptions with minimal setup
function tagOpts(toLinks: boolean, knownPages: string[] = [], dropTags: string[] = []) {
	return {
		toLinks,
		onlyExistingPages: false,
		knownPages: new Set(knownPages.map(p => p.toLowerCase())),
		dropTags: new Set(dropTags),
	};
}

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

test('does not convert alias links inside inline code or tilde fences', () => {
	const input = ['`[label]([[Page]])`', '~~~', '[label]([[Page]])', '~~~'].join('\n');
	assert.equal(convertAliasLinks(input), input);
});

// --- tags ---
test('keeps simple tags but sanitizes multi-word tags (keep-as-tag mode)', () => {
	assert.equal(convertTags('a #tag b', tagOpts(false)), 'a #tag b');
	assert.equal(convertTags('x #[[multi word]] y', tagOpts(false)), 'x #multi-word y');
});

test('converts tags to wikilinks when requested (no page filter)', () => {
	assert.equal(convertTags('a #tag b', tagOpts(true)), 'a [[tag]] b');
	assert.equal(convertTags('x #[[multi word]] y', tagOpts(true)), 'x [[multi word]] y');
});

test('does not treat a mid-word hash as a tag', () => {
	assert.equal(convertTags('color #fff and C#', tagOpts(true)), 'color [[fff]] and C#');
});

test('drops listed tags from body text', () => {
	assert.equal(convertTags('a #card b', tagOpts(false, [], ['card'])), 'a  b');
	assert.equal(convertTags('a #[[my tag]] b', tagOpts(false, [], ['my-tag'])), 'a  b');
});

test('onlyExistingPages keeps tags as tags when no matching page', () => {
	const opts = { toLinks: true, onlyExistingPages: true, knownPages: new Set(['realpage']), dropTags: new Set<string>() };
	assert.equal(convertTags('see #realpage and #unknown', opts), 'see [[realpage]] and #unknown');
});

test('onlyExistingPages converts multi-word tag only when page exists', () => {
	const opts = { toLinks: true, onlyExistingPages: true, knownPages: new Set(['multi word']), dropTags: new Set<string>() };
	assert.equal(convertTags('x #[[multi word]] y #[[nope]] z', opts), 'x [[multi word]] y #nope z');
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

// ---------------------------------------------------------------------------
// Documented transformation cases — G1, H1, and M1.
// ---------------------------------------------------------------------------

// G1: an alias reference inside an inline-code span must be left verbatim.
test('[G1] does not rewrite an alias reference inside inline code', () => {
	const index = { aliasMap: new Map([['ml', 'Machine Learning']]) };
	assert.equal(rewriteAliasReferences('use `[[ML]]` here', index), 'use `[[ML]]` here');
});

// G1: an alias equal to its own page name must not produce a redundant [[Name|Name]].
test('[G1] does not rewrite a link when the alias equals the page name', () => {
	const index = { aliasMap: new Map([['same page', 'Same Page']]) };
	assert.equal(rewriteAliasReferences('[[Same Page]]', index), '[[Same Page]]');
});

// M1: source names must follow a collision-safe path selected during preflight.
test('[M1] rewrites a source page name to its planned path', () => {
	const plans = new Map([['feedback', { target: 'Logseq/feedback 1', display: 'feedback' }]]);
	assert.equal(rewritePlannedPageLinks('[[feedback]]', plans), '[[Logseq/feedback 1|feedback]]');
});

// G1: an alias link whose target already has a pipe must not produce a double pipe.
test('[G1] alias link with piped target does not produce a double pipe', () => {
	assert.equal(convertAliasLinks('[disp]([[A|B]])'), '[[A|disp]]');
});

// H1: a hex colour token must never be treated as a tag.
test('[H1] hex colour is not converted into a tag link', () => {
	assert.equal(convertTags('#FF0000', tagOpts(true)), '#FF0000');
});

// H1: a tag preceded by an opening bracket/paren is recognized.
test('[H1] tag preceded by an opening paren is recognized', () => {
	assert.equal(convertTags('(#hashtag)', tagOpts(true)), '([[hashtag]])');
});
