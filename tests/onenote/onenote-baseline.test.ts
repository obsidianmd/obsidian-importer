/**
 * Regression baseline tests for onenote.html.
 *
 * Covers every element type present in the fixture to guard against
 * regressions in the existing conversion behaviour.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { convertFixture } from './helpers';

describe('onenote.html – baseline conversion', () => {
	let md: string;

	beforeEach(() => {
		md = convertFixture('onenote.html');
	});

	it('converts plain paragraph text', () => {
		expect(md).toContain('This is a plain paragraph with no formatting.');
	});

	it('converts bold span to **strong**', () => {
		expect(md).toContain('**bold words**');
	});

	it('converts italic span to _em_', () => {
		expect(md).toContain('_italic words_');
	});

	it('converts strikethrough span to ~~text~~', () => {
		expect(md).toContain('~~strikethrough words~~');
	});

	it('converts underlined span (no markdown equivalent — text preserved)', () => {
		expect(md).toContain('underlined words');
	});

	it('converts highlighted span text (mark → plain text fallback)', () => {
		expect(md).toContain('These words are highlighted');
	});

	it('converts unchecked flat to-do to a "- [ ]" task-list item', () => {
		expect(md).toContain('-   [ ] Unchecked task');
	});

	it('converts checked flat to-do to a "- [x]" task-list item', () => {
		expect(md).toContain('-   [x] Checked task');
	});

	it('converts unordered list', () => {
		expect(md).toContain('-   Unordered list');
	});

	it('converts ordered list', () => {
		expect(md).toContain('1.  Ordered list');
	});

	it('combines adjacent Consolas paragraphs into one fenced code block', () => {
		expect(md).toContain('```\nconst x = 1;\nconst y = 2;\n```');
	});

	it('converts inline Consolas span to backtick code', () => {
		expect(md).toContain('Call the function `myFunction()` to start.');
	});

	it('converts cite element to blockquote prefix', () => {
		// styledElementToHTML prepends "> " inside the cite innerHTML, then
		// turndown renders the cite as plain text — so the output is a literal
		// \> rather than a true blockquote block.
		expect(md).toContain('\\> This is a citation.');
	});

	it('converts italic quote paragraph', () => {
		expect(md).toContain('_This is a quoted block of text._');
	});

	it('converts H1 heading using setext underline', () => {
		expect(md).toContain('Heading 1\n=========');
	});

	it('converts H2 heading using setext underline', () => {
		expect(md).toContain('Heading 2\n---------');
	});

	it('converts H3 heading using ATX prefix', () => {
		expect(md).toContain('### Heading 3');
	});

	it('converts H4 heading to italic span (no H4 in setext/ATX output)', () => {
		// turndown has no H4 setext/ATX rule beyond H3; the italic style on the
		// OneNote H4 element causes styledElementToHTML to wrap it in <i>.
		expect(md).toContain('\n_Heading 4_\n');
	});

	it('converts H5 heading using ATX prefix', () => {
		expect(md).toContain('##### Heading 5');
	});

	it('converts internal onenote: links to page-id fragment', () => {
		expect(md).toContain('[Test page](Test)');
	});

	it('preserves external https links', () => {
		expect(md).toContain('[https://obsidian.md](https://obsidian.md)');
	});

	it('converts table to GFM table format', () => {
		expect(md).toContain('| Header A | Header B |');
		expect(md).toContain('| **BOLD TEXT** | Normal |');
	});

	it('converts important note tag to Obsidian hashtag', () => {
		expect(md).toContain('#important');
	});

	it('converts question note tag to Obsidian hashtag', () => {
		expect(md).toContain('#question');
	});

	it('converts bold paragraph text', () => {
		expect(md).toContain('**Paragraph with combined indentation and bold.**');
	});
});
