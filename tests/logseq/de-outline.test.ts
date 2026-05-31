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
