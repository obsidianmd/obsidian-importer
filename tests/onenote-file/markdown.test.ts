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

test('a OneNote page link becomes a link Obsidian can resolve after import', async () => {
	assert.equal(
		await render(para([{
			text: 'the other page',
			hyperlinkUrl: 'onenote:///C:/Notebook/Section.one#Other%20page&section-id={section}&page-id={page}&end',
		}])),
		'[the other page](Other%20page)');
});

test('a malformed OneNote page title is kept rather than failing its page', async () => {
	assert.equal(
		await render(para([{ text: 'page', hyperlinkUrl: 'onenote:///Section.one#Bad%escape&section-id={section}' }])),
		'[page](Bad%25escape)');
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

	// No blank lines between items: a gap makes it a loose list.
	assert.equal(markdown, ['- one', '\t- nested', '1. numbered'].join('\n'));
});

test('a list is separated from the prose around it', async () => {
	const markdown = await render(
		para('before'),
		para('one', { list: { level: 0, ordered: false } }),
		para('two', { list: { level: 0, ordered: false } }),
		para('after'));

	assert.equal(markdown, ['before', '', '- one', '- two', '', 'after'].join('\n'));
});

test('an item that is not a list item breaks the list', async () => {
	const markdown = await render(
		para('one', { list: { level: 0, ordered: false } }),
		para('interrupting'),
		para('two', { list: { level: 0, ordered: false } }));

	assert.equal(markdown, ['- one', '', 'interrupting', '', '- two'].join('\n'));
});

test('a list item wins over a heading style on the same paragraph', async () => {
	assert.equal(await render(para('item', { list: { level: 0, ordered: false }, styleId: 'h2' })), '- item');
});

test('a table gets a header row because GFM has no table without one', async () => {
	const markdown = await render({
		kind: 'table',
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
		rows: [{ cells: [{ children: [para('a | b')] }] }],
	});

	assert.ok(markdown.startsWith('| a \\| b |'), markdown);
});

test('a table with no rows produces nothing at all', async () => {
	assert.equal(await render({ kind: 'table', rows: [] }), '');
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

test('an equation becomes LaTeX rather than the glyphs OneNote stored', async () => {
	// OneNote writes "a=b" in the Mathematical Alphanumeric Symbols block.
	assert.equal(await render(para([{ text: '\u{1D44E}=\u{1D44F}', math: true }])), '$a=b$');
	assert.equal(await render(para([{ text: '\u{1D6FC}+\u{1D6FD}', math: true }])), '$α+β$');
	assert.equal(await render(para([{ text: '\u{1D400}\u{1D401}', math: true }])), '$AB$');
});

test('an equation keeps raised and lowered digits as LaTeX scripts', async () => {
	assert.equal(await render(para([{ text: 'x²', math: true }])), '$x^{2}$');
	assert.equal(await render(para([{ text: 'x₁₂', math: true }])), '$x_{12}$');
	assert.equal(await render(para([{ text: 'e⁻ⁿ', math: true }])), '$e^{-n}$');
});

test('the invisible operators a layout engine needs are dropped', async () => {
	assert.equal(await render(para([{ text: 'f⁡(x)', math: true }])), '$f(x)$');
	assert.equal(await render(para([{ text: '2⁢x', math: true }])), '$2x$');
});

test('emphasis is not wrapped around an equation', async () => {
	// OneNote marks its math italic; a `*` inside `$…$` stops it rendering.
	assert.equal(await render(para([{ text: '\u{1D44E}', math: true, italic: true, bold: true }])), '$a$');
});

test('an equation keeps the spacing around it', async () => {
	assert.equal(
		await render(para([{ text: 'where ' }, { text: '\u{1D465}', math: true }, { text: ' is odd' }])),
		'where $x$ is odd');
});

test('a math run holding nothing but spaces produces no delimiters', async () => {
	assert.equal(await render(para([{ text: '   ', math: true }])), '');
});

test('a OneNote to-do becomes a task, ticked or not', async () => {
	assert.equal(
		await render(para('buy milk', { tags: [{ checkable: true, completed: false }] })),
		'- [ ] buy milk');
	assert.equal(
		await render(para('done', { tags: [{ checkable: true, completed: true }] })),
		'- [x] done');
});

test('a to-do inside a list keeps its indent and loses the bullet', async () => {
	// Rendered after a line, because the page as a whole is trimmed.
	const markdown = await render(
		para('heading'),
		para('nested task', {
			list: { level: 2, ordered: false },
			tags: [{ checkable: true, completed: false }],
		}));

	assert.equal(markdown, 'heading\n\n\t\t- [ ] nested task');
});

test('consecutive tasks stay together like any other list', async () => {
	const markdown = await render(
		para('one', { tags: [{ checkable: true, completed: false }] }),
		para('two', { tags: [{ checkable: true, completed: true }] }));

	assert.equal(markdown, '- [ ] one\n- [x] two');
});

const tag = (shape: number, label?: string) => [{ checkable: false, completed: false, shape, label }];

test('a tag that means "pay attention" becomes the matching admonition', async () => {
	assert.equal(await render(para('look', { tags: tag(13, 'Important') })), '> [!important] Important\n> look');
	assert.equal(await render(para('why?', { tags: tag(15, 'Question') })), '> [!question] Question\n> why?');
	assert.equal(await render(para('run', { tags: tag(17, 'Critical') })), '> [!danger] Critical\n> run');
	assert.equal(await render(para('idea', { tags: tag(21, 'Idea') })), '> [!tip] Idea\n> idea');
});

test('a tag that merely categorises leaves its paragraph alone', async () => {
	// A phone number, a book to read, a musical note: not admonitions.
	assert.equal(await render(para('0800 1234', { tags: tag(109, 'Phone number') })), '0800 1234');
	assert.equal(await render(para('Dune', { tags: tag(132, 'Book to read') })), 'Dune');
	assert.equal(await render(para('a song', { tags: tag(121, 'Music to listen to') })), 'a song');
});

test('the title is the label as written, whatever language it is in', async () => {
	assert.equal(await render(para('merk dir das', { tags: tag(13, 'Wichtig') })), '> [!important] Wichtig\n> merk dir das');
});

test('paragraphs tagged the same way in a row become one admonition', async () => {
	const markdown = await render(
		para('first', { tags: tag(13, 'Important') }),
		para('second', { tags: tag(13, 'Important') }));

	assert.equal(markdown, '> [!important] Important\n> first\n>\n> second');
});

test('differently tagged paragraphs stay separate', async () => {
	const markdown = await render(
		para('first', { tags: tag(13, 'Important') }),
		para('second', { tags: tag(15, 'Question') }));

	assert.equal(markdown, '> [!important] Important\n> first\n\n> [!question] Question\n> second');
});

test('a tagged list item keeps its place in the list', async () => {
	const markdown = await render(
		para('one', { list: { level: 0, ordered: false } }),
		para('two', { list: { level: 0, ordered: false }, tags: tag(13, 'Important') }),
		para('three', { list: { level: 0, ordered: false } }));

	assert.equal(markdown, '- one\n- two\n- three');
});

test('a highlight carries the circle for its colour', async () => {
	assert.equal(await render(para([{ text: 'lit', highlight: '#ffff00' }])), '==🟡lit==');
	assert.equal(await render(para([{ text: 'both', highlight: '#ffff00', bold: true }])), '**==🟡both==**');
});

test('a colour between two of them takes the nearer', async () => {
	// OneNote's amber sits between orange and yellow, closer to orange.
	assert.equal(await render(para([{ text: 'amber', highlight: '#ffc000' }])), '==🟠amber==');
	assert.equal(await render(para([{ text: 'lime', highlight: '#00ff00' }])), '==🟢lime==');
	assert.equal(await render(para([{ text: 'cyan', highlight: '#00ffff' }])), '==🔵cyan==');
	assert.equal(await render(para([{ text: 'magenta', highlight: '#ff00ff' }])), '==🟣magenta==');
});

test('the emphases markdown has no syntax for fall back to HTML', async () => {
	assert.equal(await render(para([{ text: 'x', superscript: true }])), '<sup>x</sup>');
	assert.equal(await render(para([{ text: 'y', subscript: true }])), '<sub>y</sub>');
	assert.equal(await render(para([{ text: 'z', underline: true }])), '<u>z</u>');
});

test('a table cell keeps the picture in it', async () => {
	const saved: string[] = [];

	const converted = await convertPage(page({
		kind: 'table',
		rows: [{ cells: [
			{ children: [{ kind: 'image', fileName: 'in-cell.png', data: new Uint8Array([1, 2, 3]) }] },
			{ children: [para('beside it')] },
		] }],
	}), { saveAttachment: async (_bytes, name) => {
		saved.push(name); return { path: name, name }; 
	} });

	assert.equal(converted.markdown.split('\n')[0], '| ![](in-cell.png) | beside it |');
	assert.deepEqual(saved, ['in-cell.png']);
});

test('a table markdown cannot nest is reported rather than dropped', async () => {
	const skipped: [string, string][] = [];

	await convertPage(page({
		kind: 'table',
		rows: [{ cells: [{ children: [{ kind: 'table', rows: [{ cells: [{ children: [para('inner')] }] }] }] }] }],
	}), {
		saveAttachment: async () => null,
		onSkipped: (name, reason) => skipped.push([name, reason]),
	});

	assert.deepEqual(skipped, [['Test', 'not-representable']]);
});

test('text that looks like markdown is not read as markdown', async () => {
	assert.equal(await render(para('# ordinary text')), '\\# ordinary text');
	assert.equal(await render(para('- not a list')), '\\- not a list');
	assert.equal(await render(para('> not a quote')), '\\> not a quote');
	assert.equal(await render(para('1. not numbered')), '\\1. not numbered');
	assert.equal(await render(para('see [1](x)')), 'see \\[1\\](x)');
	assert.equal(await render(para('use `code`')), 'use \\`code\\`');
	assert.equal(await render(para('a <b> tag')), 'a \\<b> tag');
});

test('ordinary prose is left unmarked', async () => {
	// Escaping every emphasis character would litter the note for no gain.
	assert.equal(await render(para('a * b * c')), 'a * b * c');
	assert.equal(await render(para('file_name_here')), 'file_name_here');
	assert.equal(await render(para('2 - 1 = 1')), '2 - 1 = 1');
});

test('an escaped line keeps the formatting the importer added', async () => {
	assert.equal(
		await render(para('# text', { list: { level: 0, ordered: false } })),
		'- \\# text');
});

test('a link out of the notebook is left exactly as it was', async () => {
	// Only the onenote: scheme names a page; everything else is a real URL.
	assert.equal(
		await render(para([{ text: 'a site', hyperlinkUrl: 'https://example.com/a b' }])),
		'[a site](https://example.com/a%20b)');
	assert.equal(
		await render(para([{ text: 'a file', hyperlinkUrl: 'file:///C:/notes.txt' }])),
		'[a file](file:///C:/notes.txt)');
});

test('a OneNote link with no page in it stays a link to OneNote', async () => {
	// Without a fragment there is no page name to resolve against.
	const url = 'onenote:///C:/Notebook/Section.one';
	assert.equal(await render(para([{ text: 'the section', hyperlinkUrl: url }])), `[the section](${url})`);
});

test('the page name is taken from the fragment, not the identifiers after it', async () => {
	assert.equal(
		await render(para([{
			text: 'page',
			hyperlinkUrl: 'onenote:https://d.docs.live.net/x/Nb/S.one#Q4%20review&section-id={a}&page-id={b}&end',
		}])),
		'[page](Q4%20review)');
});

test('the importer decides what an internal link points at', async () => {
	// The conversion knows the page title; only the importer knows the note.
	const converted = await convertPage(page(para([{
		text: 'link',
		hyperlinkUrl: 'onenote:///S.one#Notes: Q4/Q1&section-id={a}',
	}])), {
		saveAttachment: async () => null,
		resolveInternalLink: title => title.replace(/[:/]/g, '-'),
	});

	assert.equal(converted.markdown, '[link](Notes-%20Q4-Q1)');
});
