/**
 * The markdown half, driven by content trees built here rather than by a file.
 *
 * The seam is what makes this possible: convertPage takes a page, not bytes,
 * so a case a real notebook happens not to contain can still be checked -
 * ragged tables, a pipe inside a cell, emphasis that would swallow its own
 * spaces. Anything a fixture does cover is checked in convert.test.ts instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertPage } from '../../src/formats/onenote-file/convert';
import type { Element, Page, Paragraph, TextRun } from '../../src/formats/onenote-file/semantic/content';

function page(...elements: Element[]): Page {
	return {
		id: 'test-page',
		title: 'Test',
		level: 0,
		isConflictPage: false,
		isDeleted: false,
		outlines: [{ kind: 'outline', children: elements }],
		directContent: [],
	};
}

function para(runs: TextRun[] | string, extra: Partial<Paragraph> = {}): Paragraph {
	return {
		kind: 'paragraph',
		runs: typeof runs === 'string' ? [{ text: runs }] : runs,
		children: [],
		...extra,
	};
}

async function render(...elements: Element[]): Promise<string> {
	const converted = await convertPage(page(...elements), {
		saveAttachment: async (_data, name) => ({ path: `files/${name}`, name }),
	});
	return converted.markdown;
}

test('emphasis wraps the words and not the spaces around them', async () => {
	assert.equal(await render(para([{ text: 'a ' }, { text: 'bold ', bold: true }, { text: 'b' }])), 'a **bold** b');
	assert.equal(await render(para([{ text: ' padded ', italic: true }])), '*padded*');
});

test('a run can carry more than one kind of emphasis', async () => {
	assert.equal(await render(para([{ text: 'x', bold: true, italic: true }])), '***x***');
	assert.equal(await render(para([{ text: 'y', bold: true, strikethrough: true }])), '~~**y**~~');
});

test('a link wraps whatever emphasis the run already had', async () => {
	assert.equal(
		await render(para([{ text: 'site', bold: true, hyperlinkUrl: 'https://example.com/a b' }])),
		'[**site**](https://example.com/a%20b)');
});

test('a run of only whitespace contributes no emphasis markers', async () => {
	assert.equal(await render(para([{ text: '   ', bold: true }])), '');
});

test('a style identifier becomes a heading', async () => {
	assert.equal(await render(para('Title', { styleId: 'h1' })), '# Title');
	assert.equal(await render(para('Deep', { styleId: 'h6' })), '###### Deep');
	assert.equal(await render(para('Body', { styleId: 'p' })), 'Body');
});

test('lists carry their bullet and their indent', async () => {
	const markdown = await render(
		para('one', { list: { level: 0, ordered: false } }),
		para('nested', { list: { level: 1, ordered: false } }),
		para('numbered', { list: { level: 0, ordered: true } }));

	assert.equal(markdown, ['- one', '', '\t- nested', '', '1. numbered'].join('\n'));
});

test('a list item wins over a heading style on the same paragraph', async () => {
	assert.equal(await render(para('item', { list: { level: 0, ordered: false }, styleId: 'h2' })), '- item');
});

test('a table gets a header row because GFM has no table without one', async () => {
	const markdown = await render({
		kind: 'table',
		bordersVisible: true,
		rows: [
			{ cells: [{ children: [para('A')] }, { children: [para('B')] }] },
			{ cells: [{ children: [para('1')] }, { children: [para('2')] }] },
		],
	});

	assert.equal(markdown, ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
});

test('a ragged table is padded to its widest row', async () => {
	const markdown = await render({
		kind: 'table',
		bordersVisible: false,
		rows: [
			{ cells: [{ children: [para('A')] }] },
			{ cells: [{ children: [para('1')] }, { children: [para('2')] }, { children: [para('3')] }] },
		],
	});

	assert.equal(markdown, ['| A |  |  |', '| --- | --- | --- |', '| 1 | 2 | 3 |'].join('\n'));
});

test('a pipe inside a cell is escaped rather than ending the cell', async () => {
	const markdown = await render({
		kind: 'table',
		bordersVisible: false,
		rows: [{ cells: [{ children: [para('a | b')] }] }],
	});

	assert.ok(markdown.startsWith('| a \\| b |'), markdown);
});

test('a table with no rows produces nothing at all', async () => {
	assert.equal(await render({ kind: 'table', bordersVisible: false, rows: [] }), '');
});

test('an image embeds and an embedded file links', async () => {
	const data = new Uint8Array([1, 2, 3]);

	assert.equal(
		await render({ kind: 'image', fileName: 'shot.png', altText: 'a shot', data }),
		'![a shot](files/shot.png)');
	assert.equal(
		await render({ kind: 'embedded-file', fileName: 'notes.docx', data }),
		'[notes.docx](files/notes.docx)');
});

test('an asset with no bytes is reported rather than linked', async () => {
	const skipped: string[] = [];

	const converted = await convertPage(page({ kind: 'image', fileName: 'gone.png' }), {
		saveAttachment: async () => assert.fail('an asset with no bytes should never be saved'),
		onSkipped: name => skipped.push(name),
	});

	assert.equal(converted.markdown, '');
	assert.deepEqual(skipped, ['gone.png']);
	assert.deepEqual(converted.attachments, []);
});

test('an asset the importer refuses is left out of the markdown', async () => {
	const converted = await convertPage(page({ kind: 'image', fileName: 'big.png', data: new Uint8Array([1]) }), {
		saveAttachment: async () => null,
	});

	assert.equal(converted.markdown, '');
	assert.deepEqual(converted.attachments, []);
});

test('every saved attachment is reported back to the caller', async () => {
	const data = new Uint8Array([1]);

	const converted = await convertPage(
		page({ kind: 'image', fileName: 'a.png', data }, { kind: 'image', fileName: 'b.png', data }),
		{ saveAttachment: async (_bytes, name) => ({ path: `files/${name}`, name }) });

	assert.deepEqual(converted.attachments.map(attachment => attachment.name), ['a.png', 'b.png']);
});

test('a line break inside a paragraph stays inside it', async () => {
	assert.equal(await render(para('first\nsecond')), 'first  \nsecond');
});

test('empty paragraphs do not pile up blank lines', async () => {
	assert.equal(await render(para(''), para('text'), para('   '), para('more')), 'text\n\nmore');
});

test('children of a paragraph follow it', async () => {
	const markdown = await render(para('parent', { children: [para('child', { list: { level: 1, ordered: false } })] }));

	assert.equal(markdown, 'parent\n\n\t- child');
});

test('cancelling stops the conversion where it stands', async () => {
	// Checked once for the enclosing outline, then once per paragraph inside it.
	let checksBeforeCancelling = 2;

	const converted = await convertPage(page(para('first'), para('second')), {
		saveAttachment: async () => null,
		isCancelled: () => checksBeforeCancelling-- <= 0,
	});

	assert.equal(converted.markdown, 'first');
});
