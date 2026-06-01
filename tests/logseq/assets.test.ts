import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAssetLinks } from '../../src/formats/logseq/assets';

test('rewrites a basic relative asset image to a wiki-embed', () => {
	const { content, assets } = convertAssetLinks('![alt](../assets/image.png)', { keepAltText: false });
	assert.equal(content, '![[image.png]]');
	assert.deepEqual(assets, [{ sourcePath: '../assets/image.png', filename: 'image.png' }]);
});

test('matches assets/ without the leading ../', () => {
	const { content, assets } = convertAssetLinks('![](assets/image.png)', { keepAltText: false });
	assert.equal(content, '![[image.png]]');
	assert.deepEqual(assets, [{ sourcePath: 'assets/image.png', filename: 'image.png' }]);
});

test('keepAltText=false drops the alt text', () => {
	const { content } = convertAssetLinks('![my caption](../assets/image.png)', { keepAltText: false });
	assert.equal(content, '![[image.png]]');
});

test('keepAltText=true keeps non-empty alt text in the display slot', () => {
	const { content } = convertAssetLinks('![my caption](../assets/image.png)', { keepAltText: true });
	assert.equal(content, '![[image.png|my caption]]');
});

test('keepAltText=true with empty alt produces a plain embed', () => {
	const { content } = convertAssetLinks('![](../assets/image.png)', { keepAltText: true });
	assert.equal(content, '![[image.png]]');
});

test('dimension suffix with width and height becomes widthxheight', () => {
	const { content, assets } = convertAssetLinks(
		'![alt](../assets/img.png){:height 214, :width 353}',
		{ keepAltText: false }
	);
	assert.equal(content, '![[img.png|353x214]]');
	assert.deepEqual(assets, [{ sourcePath: '../assets/img.png', filename: 'img.png' }]);
});

test('dimension suffix with only width becomes width', () => {
	const { content } = convertAssetLinks('![alt](../assets/img.png){:width 353}', { keepAltText: false });
	assert.equal(content, '![[img.png|353]]');
});

test('dimensions win over alt text when both apply', () => {
	const { content } = convertAssetLinks(
		'![my caption](../assets/img.png){:height 214, :width 353}',
		{ keepAltText: true }
	);
	assert.equal(content, '![[img.png|353x214]]');
});

test('dimension suffix is consumed even without keepAltText', () => {
	const { content } = convertAssetLinks(
		'before ![](../assets/img.png){:height 214, :width 353} after',
		{ keepAltText: false }
	);
	assert.equal(content, 'before ![[img.png|353x214]] after');
});

test('non-image asset embeds are also converted', () => {
	const { content, assets } = convertAssetLinks('![](../assets/doc.pdf)', { keepAltText: false });
	assert.equal(content, '![[doc.pdf]]');
	assert.deepEqual(assets, [{ sourcePath: '../assets/doc.pdf', filename: 'doc.pdf' }]);
});

test('collects multiple assets and de-duplicates identical source paths', () => {
	const input = '![a](../assets/one.png) ![b](../assets/two.png) ![c](../assets/one.png)';
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	assert.equal(content, '![[one.png]] ![[two.png]] ![[one.png]]');
	assert.deepEqual(assets, [
		{ sourcePath: '../assets/one.png', filename: 'one.png' },
		{ sourcePath: '../assets/two.png', filename: 'two.png' },
	]);
});

test('does not touch http and https URLs', () => {
	const input = '![x](http://example.com/a.png) ![y](https://example.com/assets/b.png)';
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	assert.equal(content, input);
	assert.deepEqual(assets, []);
});

test('does not touch data URLs', () => {
	const input = '![x](data:image/png;base64,iVBORw0KGgo=)';
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	assert.equal(content, input);
	assert.deepEqual(assets, []);
});

test('does not touch links whose path does not contain assets/', () => {
	const input = '![x](../images/photo.png) ![y](local.png)';
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	assert.equal(content, input);
	assert.deepEqual(assets, []);
});

test('does not transform inside fenced code blocks', () => {
	const input = [
		'![real](../assets/real.png)',
		'```',
		'![fake](../assets/fake.png)',
		'```',
		'![also](../assets/also.png)',
	].join('\n');
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	const expected = [
		'![[real.png]]',
		'```',
		'![fake](../assets/fake.png)',
		'```',
		'![[also.png]]',
	].join('\n');
	assert.equal(content, expected);
	assert.deepEqual(assets, [
		{ sourcePath: '../assets/real.png', filename: 'real.png' },
		{ sourcePath: '../assets/also.png', filename: 'also.png' },
	]);
});

test('returns content unchanged when there are no asset links', () => {
	const input = 'just some text with [a link](page.md) and no embeds';
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	assert.equal(content, input);
	assert.deepEqual(assets, []);
});

// ---------------------------------------------------------------------------
// Regression findings (domain 06) — RED tests for accepted fixes.
// ---------------------------------------------------------------------------

// H1: an asset filename containing parentheses must not be truncated at the first ')'.
test('[H1] asset filename containing parentheses is not truncated', () => {
	const { content, assets } = convertAssetLinks('![b](../assets/Book_(2024)_v0.pdf)', { keepAltText: false });
	assert.equal(content, '![[Book_(2024)_v0.pdf]]');
	assert.deepEqual(assets, [{ sourcePath: '../assets/Book_(2024)_v0.pdf', filename: 'Book_(2024)_v0.pdf' }]);
});

// H2: a plain (non-embed) link to an asset must be converted to a wiki-link and collected.
test('[H2] plain (non-embed) asset link is converted to a wiki-link and collected', () => {
	const { content, assets } = convertAssetLinks('[doc](../assets/report.pdf)', { keepAltText: false });
	assert.equal(content, '[[report.pdf]]');
	assert.deepEqual(assets, [{ sourcePath: '../assets/report.pdf', filename: 'report.pdf' }]);
});

// M1: an asset embed inside an inline-code span must be left verbatim.
test('[M1] asset link inside inline code is not rewritten', () => {
	const input = 'before `![x](../assets/a.png)` after';
	const { content, assets } = convertAssetLinks(input, { keepAltText: false });
	assert.equal(content, input);
	assert.deepEqual(assets, []);
});
