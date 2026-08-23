import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAliasLinks, convertTags, rewriteAliasReferences, rewritePlannedPageLinks } from '../../src/formats/logseq/links';

function tagOpts(toLinks: boolean, knownPages: string[] = [], dropTags: string[] = []) {
	return {
		toLinks,
		onlyExistingPages: false,
		knownPages: new Set(knownPages.map(p => p.toLowerCase())),
		dropTags: new Set(dropTags),
	};
}

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

test('keeps simple tags but sanitizes multi-word tags (keep-as-tag mode)', () => {
	assert.equal(convertTags('a #tag b', tagOpts(false)), 'a #tag b');
	assert.equal(convertTags('x #[[multi word]] y', tagOpts(false)), 'x #multi-word y');
});

test('converts tags to wikilinks when requested (no page filter)', () => {
	assert.equal(convertTags('a #tag b', tagOpts(true)), 'a [[tag]] b');
	assert.equal(convertTags('x #[[multi word]] y', tagOpts(true)), 'x [[multi word]] y');
});

test('does not treat CSS hex colours or a mid-word hash as tags', () => {
	assert.equal(convertTags('colors #fff #abcd #FF0000 #11223344 and C#', tagOpts(true)),
		'colors #fff #abcd #FF0000 #11223344 and C#');
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

test('[G1] alias link with piped target does not produce a double pipe', () => {
	assert.equal(convertAliasLinks('[disp]([[A|B]])'), '[[A|disp]]');
});

test('[H1] hex colour is not converted into a tag link', () => {
	assert.equal(convertTags('#FF0000', tagOpts(true)), '#FF0000');
});

test('[H1] tag preceded by an opening paren is recognized', () => {
	assert.equal(convertTags('(#hashtag)', tagOpts(true)), '([[hashtag]])');
});

test('a non-ASCII tag is recognised and converted', () => {
	assert.equal(convertTags('#café', tagOpts(true)), '[[café]]');
	assert.equal(convertTags('#日本語', tagOpts(true)), '[[日本語]]');
	assert.equal(convertTags('#Ünicode', tagOpts(true)), '[[Ünicode]]');
	assert.equal(convertTags('#हिन्दी', tagOpts(true)), '[[हिन्दी]]');
	assert.equal(convertTags('#cafe\u0301', tagOpts(true)), '[[cafe\u0301]]');
});

test('a non-ASCII tag can be dropped by name', () => {
	assert.equal(convertTags('a #café b', tagOpts(false, [], ['café'])), 'a  b');
	assert.equal(convertTags('a #हिन्दी b', tagOpts(false, [], ['हिन्दी'])), 'a  b');
	assert.equal(convertTags('a #cafe\u0301 b', tagOpts(false, [], ['cafe\u0301'])), 'a  b');
});

test('a hex-shaped word with a page of its own is a tag, not a colour', () => {
	for (const word of ['dad', 'bad', 'ace', 'dead', 'deaf', 'face', 'beef', 'decade']) {
		assert.equal(convertTags(`#${word}`, tagOpts(true, [word])), `[[${word}]]`, word);
	}
});

test('a hex-shaped token with no page behind it stays a colour', () => {
	assert.equal(convertTags('#fff #abcd #FF0000 #11223344', tagOpts(true)), '#fff #abcd #FF0000 #11223344');
});

test('the drop list is applied before the hex-colour guard', () => {
	assert.equal(convertTags('a #decade b', tagOpts(false, [], ['decade'])), 'a  b');
	assert.equal(convertTags('a #FF0000 b', tagOpts(false, [], ['FF0000'])), 'a  b');
});
