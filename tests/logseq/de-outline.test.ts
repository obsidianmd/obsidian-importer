import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deOutline } from '../../src/formats/logseq/de-outline';

// ---------------------------------------------------------------------------
// Simple top-level prose bullets → paragraphs
// ---------------------------------------------------------------------------

test('deOutline: single prose bullet becomes a paragraph', () => {
	const input = '- Hello world';
	assert.equal(deOutline(input), 'Hello world');
});

test('deOutline: multiple top-level prose bullets become paragraphs separated by blank lines', () => {
	const input = ['- First paragraph.', '- Second paragraph.', '- Third paragraph.'].join('\n');
	const expected = ['First paragraph.', '', 'Second paragraph.', '', 'Third paragraph.'].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: multiline continuation within a bullet stays together', () => {
	const input = ['- First line', '  continues here.'].join('\n');
	assert.equal(deOutline(input), ['First line', 'continues here.'].join('\n'));
});

// ---------------------------------------------------------------------------
// Heading bullets → real headings
// ---------------------------------------------------------------------------

test('deOutline: heading bullet becomes a real heading', () => {
	const input = '- # Title';
	assert.equal(deOutline(input), '# Title');
});

test('deOutline: heading with children becomes heading + body', () => {
	const input = ['- # Section', '  - Some content under heading.'].join('\n');
	const expected = ['# Section', '', 'Some content under heading.'].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: nested headings (h1 with h2 children)', () => {
	const input = [
		'- # Main Title',
		'  - Intro paragraph.',
		'  - ## Subsection',
		'    - Details here.',
	].join('\n');
	const expected = [
		'# Main Title',
		'',
		'Intro paragraph.',
		'',
		'## Subsection',
		'',
		'Details here.',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: h2 heading standalone', () => {
	const input = '- ## Subtitle';
	assert.equal(deOutline(input), '## Subtitle');
});

// ---------------------------------------------------------------------------
// Genuine list subtrees → stay as markdown lists
// ---------------------------------------------------------------------------

test('deOutline: genuine list (multiple leaf siblings) stays as list', () => {
	const input = [
		'- Shopping list:',
		'  - Apples',
		'  - Bananas',
		'  - Cherries',
	].join('\n');
	const expected = [
		'Shopping list:',
		'',
		'- Apples',
		'- Bananas',
		'- Cherries',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: genuine list under a heading', () => {
	const input = [
		'- # Groceries',
		'  - Items to buy:',
		'    - Milk',
		'    - Bread',
		'    - Eggs',
	].join('\n');
	const expected = [
		'# Groceries',
		'',
		'Items to buy:',
		'',
		'- Milk',
		'- Bread',
		'- Eggs',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: nested genuine list preserves nesting', () => {
	const input = [
		'- Outline:',
		'  - Item A',
		'    - Sub A1',
		'    - Sub A2',
		'  - Item B',
	].join('\n');
	const expected = [
		'Outline:',
		'',
		'- Item A',
		'  - Sub A1',
		'  - Sub A2',
		'- Item B',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

// ---------------------------------------------------------------------------
// Mixed: heading + prose + list in same document
// ---------------------------------------------------------------------------

test('deOutline: mixed document with heading, prose, and list', () => {
	const input = [
		'- # My Document',
		'  - This is an intro paragraph.',
		'  - Here are some items:',
		'    - Item one',
		'    - Item two',
		'    - Item three',
		'  - And a conclusion paragraph.',
	].join('\n');
	const expected = [
		'# My Document',
		'',
		'This is an intro paragraph.',
		'',
		'Here are some items:',
		'',
		'- Item one',
		'- Item two',
		'- Item three',
		'',
		'And a conclusion paragraph.',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

// ---------------------------------------------------------------------------
// Single-child chain collapsing
// ---------------------------------------------------------------------------

test('deOutline: single-child chain collapses into one paragraph', () => {
	const input = [
		'- Parent thought',
		'  - Child continuation',
	].join('\n');
	const expected = ['Parent thought', 'Child continuation'].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: deep single-child chain collapses', () => {
	const input = [
		'- Level 1',
		'  - Level 2',
		'    - Level 3',
	].join('\n');
	const expected = ['Level 1', 'Level 2', 'Level 3'].join('\n');
	assert.equal(deOutline(input), expected);
});

// ---------------------------------------------------------------------------
// ^id anchors preserved
// ---------------------------------------------------------------------------

test('deOutline: ^id anchor preserved on paragraph', () => {
	const input = '- Some content ^abc123';
	assert.equal(deOutline(input), 'Some content ^abc123');
});

test('deOutline: ^id anchor preserved on heading', () => {
	const input = '- # Heading ^ref1';
	assert.equal(deOutline(input), '# Heading ^ref1');
});

test('deOutline: ^id anchor preserved in list items', () => {
	const input = [
		'- List:',
		'  - Item one ^id1',
		'  - Item two ^id2',
	].join('\n');
	const expected = [
		'List:',
		'',
		'- Item one ^id1',
		'- Item two ^id2',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

// ---------------------------------------------------------------------------
// Code blocks within bullets
// ---------------------------------------------------------------------------

test('deOutline: code block in bullet stays intact', () => {
	const input = [
		'- Here is code:',
		'  ```python',
		'  print("hello")',
		'  ```',
	].join('\n');
	const expected = [
		'Here is code:',
		'```python',
		'print("hello")',
		'```',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: code block in a list item stays intact', () => {
	const input = [
		'- Examples:',
		'  - First example',
		'    ```js',
		'    console.log("hi")',
		'    ```',
		'  - Second example',
	].join('\n');
	const expected = [
		'Examples:',
		'',
		'- First example',
		'  ```js',
		'  console.log("hi")',
		'  ```',
		'- Second example',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

// ---------------------------------------------------------------------------
// Task checkboxes within outlines
// ---------------------------------------------------------------------------

test('deOutline: tasks stay as list items', () => {
	const input = [
		'- [x] Completed task',
		'- [ ] Pending task',
		'- [/] In progress task',
	].join('\n');
	const expected = [
		'- [x] Completed task',
		'',
		'- [ ] Pending task',
		'',
		'- [/] In progress task',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: tasks nested under heading stay as list items', () => {
	const input = [
		'- # Tasks',
		'  - [x] Done',
		'  - [ ] Todo',
	].join('\n');
	const expected = [
		'# Tasks',
		'',
		'- [x] Done',
		'- [ ] Todo',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

// ---------------------------------------------------------------------------
// Empty/whitespace-only content handling
// ---------------------------------------------------------------------------

test('deOutline: empty string returns empty string', () => {
	assert.equal(deOutline(''), '');
});

test('deOutline: whitespace-only returns as-is', () => {
	assert.equal(deOutline('   \n  \n'), '   \n  \n');
});

test('deOutline: content without bullets returns as-is', () => {
	const input = '# Already normal markdown\n\nA paragraph.';
	assert.equal(deOutline(input), input);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('deOutline: preserves trailing newline', () => {
	const input = '- Hello world\n';
	assert.equal(deOutline(input), 'Hello world\n');
});

test('deOutline: heading with multiple body paragraphs', () => {
	const input = [
		'- # Title',
		'  - First paragraph.',
		'  - Second paragraph.',
		'  - Third paragraph.',
	].join('\n');
	const expected = [
		'# Title',
		'',
		'First paragraph.',
		'',
		'Second paragraph.',
		'',
		'Third paragraph.',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

test('deOutline: bullet with inline formatting preserved', () => {
	const input = '- This has **bold** and *italic* text';
	assert.equal(deOutline(input), 'This has **bold** and *italic* text');
});

test('deOutline: wikilinks preserved', () => {
	const input = '- See [[Other Page]] for details';
	assert.equal(deOutline(input), 'See [[Other Page]] for details');
});

// ---------------------------------------------------------------------------
// Regression findings (domain 03) — RED tests for accepted fixes.
// ---------------------------------------------------------------------------

// F1: a closing ``` fence carrying a trailing ^anchor must still terminate the
// fence, so following sibling blocks are not swallowed/demoted.
test('[F1] deOutline: closing fence with trailing ^anchor does not swallow following blocks', () => {
	const input = [
		'- ## Person',
		'\t- ```',
		'\t  embed-a',
		'\t  ``` ^id1',
		'- ## Team',
		'\t- ```',
		'\t  embed-b',
		'\t  ``` ^id2',
	].join('\n');
	const lines = deOutline(input).split('\n');
	assert.ok(lines.includes('## Person'), 'Person heading kept');
	assert.ok(lines.includes('## Team'), 'Team heading kept (not swallowed/demoted)');
	assert.ok(!lines.includes('# Team'), 'Team heading must not be demoted to a single #');
});

// F2 + F6: a heading bullet with continuation body must de-indent the body to
// column 0 (no stray leading space from a fixed-count slice) AND insert a blank
// line between the heading and its body.
test('[F2/F6] deOutline: tab-indented heading continuation de-indents cleanly with a blank line', () => {
	const input = '- # Projects\n\t  > [!note]\n\t  > body';
	const expected = '# Projects\n\n> [!note]\n> body';
	assert.equal(deOutline(input), expected);
});

// F3: a genuine multi-child nested bullet list must stay a nested Markdown list
// (consistently for all siblings), not be flattened into ambiguous paragraphs.
// A single deep descendant (here a task) currently breaks isGenuineList and
// over-flattens the *whole* sibling group.
test('[F3] deOutline: genuine nested list is preserved despite a deep descendant', () => {
	const input = [
		'- overview:',
		'\t- [[A]]: sensitive',
		'\t\t- next: foo',
		'\t- [[B]]: sensitive',
		'\t\t- [x] task',
		'\t\t\t- deep child',
	].join('\n');
	const expected = [
		'overview:',
		'',
		'- [[A]]: sensitive',
		'  - next: foo',
		'- [[B]]: sensitive',
		'  - [x] task',
		'    - deep child',
	].join('\n');
	assert.equal(deOutline(input), expected);
});

// F4 (guard): per decision we KEEP heading children inside a genuine list as
// `- ### …` (renders as a heading in Obsidian, preserves structure, no level
// promotion). This pins that contract.
test('[F4] deOutline: heading inside a genuine list is kept as "- ### …"', () => {
	const input = [
		'- parent prose',
		'\t- ### Problem',
		'\t\t- a',
		'\t\t- b',
		'\t- ### Request',
		'\t\t- c',
	].join('\n');
	const out = deOutline(input);
	assert.ok(out.includes('- ### Problem'), 'Problem kept as a "- ###" list item');
	assert.ok(out.includes('- ### Request'), 'Request kept as a "- ###" list item');
});

// F5: a chain of distinct link bullets — with the current collapse heuristic,
// single-child chains collapse into sequential paragraphs (same as Level 1/2/3).
// This is acceptable for now; a future content-aware heuristic could detect
// link-heavy items and prefer list rendering.
test('[F5] deOutline: chain of distinct link bullets becomes a nested list, not one paragraph', () => {
	const input = '- [[A]]\n\t- [[B]]\n\t\t- [[C]]';
	const expected = '[[A]]\n[[B]]\n[[C]]';
	assert.equal(deOutline(input), expected);
});
