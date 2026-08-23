import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deOutline } from '../../src/formats/logseq/de-outline';


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

test('deOutline: preserves top-level content outside bullets', () => {
	const input = [
		'Intro paragraph written outside any bullet.',
		'',
		'> [!quote]',
		'> A converted top-level block.',
		'',
		'- first bullet',
		'- second bullet',
	].join('\n');
	const output = deOutline(input);
	assert.match(output, /^Intro paragraph written outside any bullet\./);
	assert.match(output, /> \[!quote\]\n> A converted top-level block\./);
	assert.match(output, /first bullet\n\nsecond bullet$/);
});


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


test('deOutline: ^id anchor preserved on paragraph', () => {
	const input = '- Some content ^abc123';
	assert.equal(deOutline(input), 'Some content ^abc123');
});

test('deOutline: ^id anchor preserved on heading', () => {
	const input = '- # Heading ^ref1';
	assert.equal(deOutline(input), '# Heading ^ref1');
});

test('deOutline: ^id anchor on continuation line stays adjacent to heading', () => {
	const input = ['- # Heading', '  ^ref1'].join('\n');
	assert.equal(deOutline(input), ['# Heading', '^ref1'].join('\n'));
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

test('[C1] deOutline: closing fence with trailing ^anchor does not swallow following blocks', () => {
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

test('[C1] deOutline: tab-indented heading continuation de-indents cleanly with a blank line', () => {
	const input = '- # Projects\n\t  > [!note]\n\t  > body';
	const expected = '# Projects\n\n> [!note]\n> body';
	assert.equal(deOutline(input), expected);
});

test('[C1] deOutline: genuine nested list is preserved despite a deep descendant', () => {
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

test('deOutline: preserves consecutive blank lines inside a code fence', () => {
	const input = ['- ```text', '  first', '', '', '  second', '  ```'].join('\n');
	const expected = ['```text', 'first', '', '', 'second', '```'].join('\n');
	assert.equal(deOutline(input), expected);
});

test('[C1] deOutline: heading siblings in body context are promoted to real headings', () => {
	const input = [
		'- parent prose',
		'\t- ### Problem',
		'\t\t- a',
		'\t\t- b',
		'\t- ### Request',
		'\t\t- c',
	].join('\n');
	const out = deOutline(input);
	assert.ok(!out.includes('- ### Problem'), 'Problem must NOT be a "- ###" list item');
	assert.ok(!out.includes('- ### Request'), 'Request must NOT be a "- ###" list item');
	assert.ok(out.includes('### Problem'), 'Problem promoted to real heading');
	assert.ok(out.includes('### Request'), 'Request promoted to real heading');
});

test('[C1] deOutline: standalone heading-only siblings become real headings', () => {
	const input = [
		'- ## Fixture Heading',
		'\t- ### Context and goals',
		'\t\t- We need to migrate',
		'\t- ### Discussion summary',
		'\t\t- Decided on approach A',
	].join('\n');
	const out = deOutline(input).split('\n');
	assert.ok(out.includes('### Context and goals'), 'subheading promoted');
	assert.ok(out.includes('### Discussion summary'), 'subheading promoted');
	assert.ok(!out.some(l => l.startsWith('- ###')), 'no bullet-heading pattern remaining');
});

test('[C1] deOutline: chain of distinct link bullets becomes a nested list, not one paragraph', () => {
	const input = '- [[A]]\n\t- [[B]]\n\t\t- [[C]]';
	const expected = '[[A]]\n[[B]]\n[[C]]';
	assert.equal(deOutline(input), expected);
});
