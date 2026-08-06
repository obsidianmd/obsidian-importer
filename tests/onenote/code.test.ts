/**
 * The predicates that decide what OneNote considered a code block.
 *
 * OneNote marks code by font rather than by element, so these read style and
 * shape instead of tags. They had no test until now, and no test could have
 * caught anything: both checked element constructors, and under the shim
 * HTMLBRElement does not exist while <p> is never specialised, so one threw and
 * the other was false for every input. They are asserted here in both
 * directions - the true case as well as the false one - because a predicate
 * that answers "no" to everything looks exactly like a passing test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../shims/dom';
import '../shims/runtime';

import {
	getSiblingsInSameCodeBlock,
	isBRElement,
	isFenceCodeBlock,
	isInlineCodeSpan,
	isParagraphWrappingOnlyCode,
} from '../../src/formats/onenote/code';

/** OneNote's marker for code: the font, on a span. */
const CODE = 'style="font-family:Consolas"';

function body(html: string): HTMLElement {
	const doc = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
	return doc.querySelector('body') as unknown as HTMLElement;
}

test('a <br> is recognised, and nothing else is', () => {
	const el = body('<br><p>text</p>');
	assert.equal(isBRElement(el.querySelector('br')), true);
	assert.equal(isBRElement(el.querySelector('p')), false);
	assert.equal(isBRElement(null), false);
});

test('a paragraph of only code spans and breaks is a code paragraph', () => {
	const el = body(`<p><span ${CODE}>let a = 1</span><br><span ${CODE}>let b = 2</span></p>`);
	assert.equal(isParagraphWrappingOnlyCode(el.querySelector('p')), true);
});

test('a paragraph with any non-code content is not', () => {
	for (const html of [
		'<p>plain text</p>',
		`<p><span ${CODE}>code</span> and text</p>`,
		`<p><span ${CODE}>code</span><em>emphasis</em></p>`,
	]) {
		assert.equal(isParagraphWrappingOnlyCode(body(html).querySelector('p')), false, html);
	}
});

test('an empty paragraph is not a code paragraph', () => {
	// every() holds vacuously over no children, so an empty <p> answered yes.
	// combineCodeBlocksAsNecessary merges any two adjacent code paragraphs, so
	// a blank line beside a code block was folded into it, leaving two stray
	// <br> against the code rather than a paragraph break.
	assert.equal(isParagraphWrappingOnlyCode(body('<p></p>').querySelector('p')), false);
});

test('a lone code span is inline, a multi-line one is a fence', () => {
	const inline = body(`<p><span ${CODE}>inline</span></p>`);
	assert.equal(isInlineCodeSpan(inline.querySelector('span')!), true);
	assert.equal(isFenceCodeBlock(inline.querySelector('span')!), false);

	// Two code spans joined by a break are one block, so neither is inline
	const fenced = body(`<p><span ${CODE}>let a = 1</span><br><span ${CODE}>let b = 2</span></p>`);
	const first = fenced.querySelector('span')!;
	assert.equal(isInlineCodeSpan(first), false);
	assert.equal(isFenceCodeBlock(first), true);
});

test('a code block gathers its siblings and stops at the last code span', () => {
	const el = body(`<p><span ${CODE}>a</span><br><span ${CODE}>b</span><br></p>`);
	const first = el.querySelector('span')!;

	// The trailing <br> is dropped: a block ends on code, not on a break
	const siblings = getSiblingsInSameCodeBlock(first);
	assert.deepEqual(siblings.map(n => n.nodeName), ['BR', 'SPAN']);
});
