import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	convertHighlights,
	convertNumberedLists,
	convertOrgBlocks,
	convertMediaEmbeds,
	fixCodeBlocksInLists,
	fixHeadingChildLists,
} from '../../src/formats/logseq/blocks';

// ---------------------------------------------------------------------------
// fixHeadingChildLists
// ---------------------------------------------------------------------------

test('fixHeadingChildLists: prefixes a heading that owns an indented child list', () => {
	const input = ['# Heading', '\t- list item 1', '\t- list item 2'].join('\n');
	const expected = ['- # Heading', '\t- list item 1', '\t- list item 2'].join('\n');
	assert.equal(fixHeadingChildLists(input), expected);
});

test('fixHeadingChildLists: leaves a heading without an indented child list', () => {
	const input = ['# Heading', 'some text'].join('\n');
	assert.equal(fixHeadingChildLists(input), input);
});

test('fixHeadingChildLists: leaves a heading already inside a bullet', () => {
	const input = ['- # Heading', '\t- child'].join('\n');
	assert.equal(fixHeadingChildLists(input), input);
});

// ---------------------------------------------------------------------------
// convertHighlights
// ---------------------------------------------------------------------------

test('convertHighlights: basic highlight', () => {
	assert.equal(convertHighlights('a ^^b^^ c'), 'a ==b== c');
});

test('convertHighlights: multiple highlights on one line', () => {
	assert.equal(convertHighlights('^^one^^ and ^^two^^'), '==one== and ==two==');
});

test('convertHighlights: highlight spanning words', () => {
	assert.equal(convertHighlights('text ^^a b c^^ end'), 'text ==a b c== end');
});

test('convertHighlights: leaves plain text untouched', () => {
	assert.equal(convertHighlights('nothing to see here'), 'nothing to see here');
});

test('convertHighlights: does not transform inside fenced code block', () => {
	const input = ['before ^^x^^', '```', 'leave ^^y^^ alone', '```', 'after ^^z^^'].join('\n');
	const expected = ['before ==x==', '```', 'leave ^^y^^ alone', '```', 'after ==z=='].join('\n');
	assert.equal(convertHighlights(input), expected);
});

test('convertHighlights: does not transform inside inline code span', () => {
	assert.equal(convertHighlights('use `^^x^^` here'), 'use `^^x^^` here');
});

test('convertHighlights: mixes inline code and real highlight', () => {
	assert.equal(convertHighlights('`^^a^^` but ^^b^^'), '`^^a^^` but ==b==');
});

test('convertHighlights: language-tagged fence is protected', () => {
	const input = ['```python', 'x = "^^hl^^"', '```'].join('\n');
	assert.equal(convertHighlights(input), input);
});

test('convertHighlights: tilde and list-prefixed fences are protected', () => {
	const tilde = ['~~~md', '^^tilde^^', '~~~'].join('\n');
	const listed = ['- ```md', '  ^^listed^^', '  ```'].join('\n');
	assert.equal(convertHighlights(tilde), tilde);
	assert.equal(convertHighlights(listed), listed);
});

// ---------------------------------------------------------------------------
// convertNumberedLists
// ---------------------------------------------------------------------------

test('convertNumberedLists: basic two-item example', () => {
	const input = [
		'- one',
		'  logseq.order-list-type:: number',
		'- two',
		'  logseq.order-list-type:: number',
	].join('\n');
	const expected = ['1. one', '2. two'].join('\n');
	assert.equal(convertNumberedLists(input), expected);
});

test('convertNumberedLists: counter reaches three', () => {
	const input = [
		'- a',
		'  logseq.order-list-type:: number',
		'- b',
		'  logseq.order-list-type:: number',
		'- c',
		'  logseq.order-list-type:: number',
	].join('\n');
	assert.equal(convertNumberedLists(input), ['1. a', '2. b', '3. c'].join('\n'));
});

test('convertNumberedLists: bullets without property stay as dashes', () => {
	const input = ['- plain one', '- plain two'].join('\n');
	assert.equal(convertNumberedLists(input), input);
});

test('convertNumberedLists: counter resets after a plain sibling', () => {
	const input = [
		'- one',
		'  logseq.order-list-type:: number',
		'- two',
		'  logseq.order-list-type:: number',
		'- plain',
		'- three',
		'  logseq.order-list-type:: number',
	].join('\n');
	const expected = ['1. one', '2. two', '- plain', '1. three'].join('\n');
	assert.equal(convertNumberedLists(input), expected);
});

test('convertNumberedLists: nested numbered list keeps per-level counters', () => {
	const input = [
		'- a',
		'  logseq.order-list-type:: number',
		'  - b',
		'    logseq.order-list-type:: number',
		'  - c',
		'    logseq.order-list-type:: number',
		'- d',
		'  logseq.order-list-type:: number',
	].join('\n');
	const expected = ['1. a', '  1. b', '  2. c', '2. d'].join('\n');
	assert.equal(convertNumberedLists(input), expected);
});

test('convertNumberedLists: nested list restarts under a new parent', () => {
	const input = [
		'- a',
		'  logseq.order-list-type:: number',
		'  - x',
		'    logseq.order-list-type:: number',
		'- b',
		'  logseq.order-list-type:: number',
		'  - y',
		'    logseq.order-list-type:: number',
	].join('\n');
	const expected = ['1. a', '  1. x', '2. b', '  1. y'].join('\n');
	assert.equal(convertNumberedLists(input), expected);
});

// ---------------------------------------------------------------------------
// convertOrgBlocks
// ---------------------------------------------------------------------------

test('convertOrgBlocks: QUOTE becomes blockquote', () => {
	const input = ['#+BEGIN_QUOTE', 'Hello', 'World', '#+END_QUOTE'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> Hello', '> World'].join('\n'));
});

test('convertOrgBlocks: NOTE without title becomes callout', () => {
	const input = ['#+BEGIN_TIP', 'just text', '#+END_TIP'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!tip]', '> just text'].join('\n'));
});

test('convertOrgBlocks: NOTE with bold first line uses it as title', () => {
	const input = ['#+BEGIN_NOTE', '**Important Title**', 'body line', '#+END_NOTE'].join('\n');
	assert.equal(
		convertOrgBlocks(input),
		['> [!note] Important Title', '> body line'].join('\n')
	);
});

test('convertOrgBlocks: case-insensitive block type', () => {
	const input = ['#+begin_warning', 'careful', '#+end_warning'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!warning]', '> careful'].join('\n'));
});

test('convertOrgBlocks: COMMENT becomes Obsidian comment', () => {
	const input = ['#+BEGIN_COMMENT', 'secret', '#+END_COMMENT'].join('\n');
	assert.equal(convertOrgBlocks(input), ['%%', 'secret', '%%'].join('\n'));
});

test('convertOrgBlocks: CENTER falls back to note callout', () => {
	const input = ['#+BEGIN_CENTER', 'centered', '#+END_CENTER'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!note]', '> centered'].join('\n'));
});

test('convertOrgBlocks: nested quote inside callout gets extra blockquote', () => {
	const input = [
		'#+BEGIN_NOTE',
		'intro',
		'#+BEGIN_QUOTE',
		'quoted',
		'#+END_QUOTE',
		'#+END_NOTE',
	].join('\n');
	assert.equal(
		convertOrgBlocks(input),
		['> [!note]', '> intro', '> > quoted'].join('\n')
	);
});

test('convertOrgBlocks: preserves indentation for blocks nested in list items', () => {
	const input = ['- item', '  #+BEGIN_QUOTE', '  quoted', '  #+END_QUOTE'].join('\n');
	assert.equal(convertOrgBlocks(input), ['- item', '  > quoted'].join('\n'));
});

test('convertOrgBlocks: unmatched begin is left unchanged', () => {
	const input = ['#+BEGIN_QUOTE', 'hello', 'no end here'].join('\n');
	assert.equal(convertOrgBlocks(input), input);
});

test('convertOrgBlocks: text around block is preserved', () => {
	const input = ['before', '#+BEGIN_QUOTE', 'q', '#+END_QUOTE', 'after'].join('\n');
	assert.equal(convertOrgBlocks(input), ['before', '> q', 'after'].join('\n'));
});

// ---------------------------------------------------------------------------
// fixCodeBlocksInLists
// ---------------------------------------------------------------------------

test('fixCodeBlocksInLists: indents closing fence to match bullet code', () => {
	const input = ['- ```python', '  print(1)', '```'].join('\n');
	const expected = ['- ```python', '  print(1)', '  ```'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), expected);
});

test('fixCodeBlocksInLists: already-correct closing fence is unchanged', () => {
	const input = ['- ```js', '  x', '  ```'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), input);
});

test('fixCodeBlocksInLists: top-level code block is left unchanged', () => {
	const input = ['```', 'code', '```'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), input);
});

test('fixCodeBlocksInLists: deeper nested bullet keeps deeper indent', () => {
	const input = ['  - ```ts', '    y', '```'].join('\n');
	const expected = ['  - ```ts', '    y', '    ```'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), expected);
});

test('fixCodeBlocksInLists: does not alter code content lines', () => {
	const input = ['- ```python', '  ^^not a highlight^^', '  result = 2', '```'].join('\n');
	const expected = ['- ```python', '  ^^not a highlight^^', '  result = 2', '  ```'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), expected);
});

// ---------------------------------------------------------------------------
// convertMediaEmbeds
// ---------------------------------------------------------------------------

test('convertMediaEmbeds: converts {{video URL}}', () => {
	assert.equal(convertMediaEmbeds('- {{video https://example.com/v.mp4}}'), '- ![](https://example.com/v.mp4)');
});

test('convertMediaEmbeds: converts {{youtube URL}}', () => {
	assert.equal(
		convertMediaEmbeds('- {{youtube https://www.youtube.com/watch?v=abc123}}'),
		'- ![](https://www.youtube.com/watch?v=abc123)'
	);
});

test('convertMediaEmbeds: converts {{tweet URL}}', () => {
	assert.equal(
		convertMediaEmbeds('- {{tweet https://twitter.com/user/status/999}}'),
		'- ![](https://twitter.com/user/status/999)'
	);
});

test('convertMediaEmbeds: handles extra whitespace around URL', () => {
	assert.equal(
		convertMediaEmbeds('{{video   https://example.com/v.mp4  }}'),
		'![](https://example.com/v.mp4)'
	);
});

test('convertMediaEmbeds: multiple embeds on separate lines', () => {
	const input = ['- {{video https://a.com/1.mp4}}', '- {{youtube https://b.com/2}}'].join('\n');
	const expected = ['- ![](https://a.com/1.mp4)', '- ![](https://b.com/2)'].join('\n');
	assert.equal(convertMediaEmbeds(input), expected);
});

test('convertMediaEmbeds: does not convert inside fenced code', () => {
	const input = ['```', '{{video https://inside.com/x}}', '```'].join('\n');
	assert.equal(convertMediaEmbeds(input), input);
});

test('convertMediaEmbeds: leaves {{embed}} untouched (handled elsewhere)', () => {
	const input = '- {{embed [[Page]]}}';
	assert.equal(convertMediaEmbeds(input), input);
});

test('convertMediaEmbeds: leaves {{query}} untouched', () => {
	const input = '- {{query (and [[tag]])}}';
	assert.equal(convertMediaEmbeds(input), input);
});

// ---------------------------------------------------------------------------
// convertOrgBlocks: additional edge cases
// ---------------------------------------------------------------------------

test('convertOrgBlocks: EXAMPLE block uses example callout type', () => {
	const input = ['#+BEGIN_EXAMPLE', 'sample code', '#+END_EXAMPLE'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!example]', '> sample code'].join('\n'));
});

test('convertOrgBlocks: IMPORTANT block', () => {
	const input = ['#+BEGIN_IMPORTANT', 'do not forget', '#+END_IMPORTANT'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!important]', '> do not forget'].join('\n'));
});

test('convertOrgBlocks: CAUTION block', () => {
	const input = ['#+BEGIN_CAUTION', 'be warned', '#+END_CAUTION'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!caution]', '> be warned'].join('\n'));
});

test('convertOrgBlocks: VERSE falls back to note callout', () => {
	const input = ['#+BEGIN_VERSE', 'roses are red', '#+END_VERSE'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!note]', '> roses are red'].join('\n'));
});

test('convertOrgBlocks: PINNED falls back to note callout', () => {
	const input = ['#+BEGIN_PINNED', 'pinned content', '#+END_PINNED'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> [!note]', '> pinned content'].join('\n'));
});

test('convertOrgBlocks: empty block body produces header only', () => {
	const input = ['#+BEGIN_TIP', '#+END_TIP'].join('\n');
	assert.equal(convertOrgBlocks(input), '> [!tip]');
});

test('convertOrgBlocks: multi-line QUOTE preserves blank lines as empty blockquote', () => {
	const input = ['#+BEGIN_QUOTE', 'line 1', '', 'line 2', '#+END_QUOTE'].join('\n');
	assert.equal(convertOrgBlocks(input), ['> line 1', '>', '> line 2'].join('\n'));
});

// ---------------------------------------------------------------------------
// Documented transformation cases — J1.
// ---------------------------------------------------------------------------

// J1: bullet-prefixed `- #+BEGIN_*` blocks are currently left raw because
// BEGIN_RE anchors `#+BEGIN` right after the indent. Decision: keep the bullet,
// render the callout as the bullet's content (`- > [!tip]` / `  > body`).
test('[J1] convertOrgBlocks: tab-indented bullet TIP becomes a callout under the bullet', () => {
	const input = ['\t- #+BEGIN_TIP', '\t  body', '\t  #+END_TIP'].join('\n');
	const expected = ['\t- > [!tip]', '\t  > body'].join('\n');
	assert.equal(convertOrgBlocks(input), expected);
});

test('[J1] convertOrgBlocks: bullet TIP keeps a bold first line as the callout title', () => {
	const input = ['- #+BEGIN_TIP', '  **Role**', '  body', '  #+END_TIP'].join('\n');
	const expected = ['- > [!tip] Role', '  > body'].join('\n');
	assert.equal(convertOrgBlocks(input), expected);
});

test('[J1] convertOrgBlocks: bullet QUOTE becomes a blockquote under the bullet', () => {
	const input = ['- #+BEGIN_QUOTE', '  quoted', '  #+END_QUOTE'].join('\n');
	const expected = ['- > quoted'].join('\n');
	assert.equal(convertOrgBlocks(input), expected);
});

// J1: closing fence is re-emitted as spaces (tab counted as 1 char), losing
// the original tab indentation and breaking list nesting. Decision: preserve the
// opener's exact indentation on the closing fence (leave an already-aligned block
// untouched).
test('[J1] fixCodeBlocksInLists: preserves tab indentation on the closing fence', () => {
	const input = ['\t- ```js', '\t  x', '\t  ```'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), input);
});

test('[J1] fixCodeBlocksInLists: preserves a tab used after the bullet marker', () => {
	const input = ['-\t~~~js', '\tx', '~~~'].join('\n');
	const expected = ['-\t~~~js', '\tx', '\t~~~'].join('\n');
	assert.equal(fixCodeBlocksInLists(input), expected);
});

// J1: convertOrgBlocks has no fence-awareness and converts `#+BEGIN_*` that
// appears literally inside a fenced code block. Decision: leave code content inert.
test('[J1] convertOrgBlocks: leaves org markup inside a code fence untouched', () => {
	const input = ['```', '#+BEGIN_QUERY', 'q', '#+END_QUERY', '```'].join('\n');
	assert.equal(convertOrgBlocks(input), input);
});

// J1: `#+BEGIN_QUERY` currently falls back to a `[!note]` callout, silently
// relabelling the query DSL as prose. Decision: preserve verbatim in a ```query fence.
test('[J1] convertOrgBlocks: QUERY is preserved verbatim in a ```query fence', () => {
	const input = ['#+BEGIN_QUERY', '{:title "x"}', '#+END_QUERY'].join('\n');
	const expected = ['```query', '{:title "x"}', '```'].join('\n');
	assert.equal(convertOrgBlocks(input), expected);
});

// J1: convertHighlights' fence detector (`/^\s*```/`) misses a bullet-opened
// fence, so highlights inside such a code block get converted. Decision: recognise
// the bullet-opened form and leave code content inert.
test('[J1] convertHighlights: ignores a bullet-opened code fence', () => {
	const input = ['- ```', '^^x^^', '```'].join('\n');
	assert.equal(convertHighlights(input), input);
});

// J1 (guard): a tab-indented numbered list must number independently and
// correctly (documents the expected contract; no live misconversion observed).
test('[J1] convertNumberedLists: tab-indented numbered list numbers correctly', () => {
	const input = [
		'\t- one',
		'\t  logseq.order-list-type:: number',
		'\t- two',
		'\t  logseq.order-list-type:: number',
	].join('\n');
	const expected = ['\t1. one', '\t2. two'].join('\n');
	assert.equal(convertNumberedLists(input), expected);
});
