/**
 * The pass that puts every importer's markdown in the vault's form.
 *
 * Checked here rather than in a recording, which would have to pick one vault
 * to be recorded against.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMarkdown } from '../../src/markdown-output';

const TABS = { indentUnit: '\t' };
const SPACES = { indentUnit: '    ' };

test('rewrites four-space list indentation as tabs', () => {
	const converted = [
		'- Block level',
		'    - testing',
		'    - test',
		'        - testing',
	].join('\n');

	assert.equal(formatMarkdown(converted, TABS), [
		'- Block level',
		'\t- testing',
		'\t- test',
		'\t\t- testing',
	].join('\n'));
});

test('rewrites tab list indentation as spaces', () => {
	const converted = [
		'- Block level',
		'\t- testing',
		'\t\t- testing',
	].join('\n');

	assert.equal(formatMarkdown(converted, SPACES), [
		'- Block level',
		'    - testing',
		'        - testing',
	].join('\n'));
});

test('leaves indentation already in the vault\'s form alone', () => {
	const markdown = ['- one', '    - two'].join('\n');

	assert.equal(formatMarkdown(markdown, SPACES), markdown);
});

test('handles ordered and task lists', () => {
	assert.equal(formatMarkdown(['1. one', '    2. two'].join('\n'), TABS), ['1. one', '\t2. two'].join('\n'));
	assert.equal(formatMarkdown(['- [ ] one', '    - [x] two'].join('\n'), TABS), ['- [ ] one', '\t- [x] two'].join('\n'));
});

test('keeps the alignment that holds a wrapped line inside its item', () => {
	assert.equal(
		formatMarkdown(['- one', '    - two', '      wrapped'].join('\n'), TABS),
		['- one', '\t- two', '\t  wrapped'].join('\n'));
});

test('moves a fenced block with its item without touching the code', () => {
	const converted = [
		'- Code',
		'    - ```python',
		'      def f():',
		'          return 1',
		'      ```',
	].join('\n');

	// The code keeps its four-space indent: it is Python, not a list
	assert.equal(formatMarkdown(converted, TABS), [
		'- Code',
		'\t- ```python',
		'\t  def f():',
		'\t      return 1',
		'\t  ```',
	].join('\n'));
});

test('leaves a list inside a code fence as written', () => {
	// A sample of markdown, not a list: reindenting it changes the code
	const markdown = [
		'```markdown',
		'- one',
		'    - two',
		'```',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('leaves indentation that is not a list alone', () => {
	const markdown = [
		'A paragraph.',
		'',
		'    an indented code block',
		'',
		'```',
		'    indented inside a fence',
		'```',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('does not carry a list across the paragraph that ends it', () => {
	const markdown = [
		'- one',
		'',
		'A paragraph.',
		'',
		'    an indented code block',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('leaves frontmatter alone', () => {
	const markdown = [
		'---',
		'aliases:',
		'  - one',
		'---',
		'',
		'- one',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('writes every bullet as a dash', () => {
	assert.equal(
		formatMarkdown(['* one', '    + two', '        - three'].join('\n'), SPACES),
		['- one', '    - two', '        - three'].join('\n'));
});

test('leaves ordered lists numbered as they were', () => {
	const markdown = ['1. one', '2) two'].join('\n');

	assert.equal(formatMarkdown(markdown, SPACES), markdown);
});

test('does not mistake a thematic break for a bullet', () => {
	const markdown = ['* * *', '***', '- - -', '___'].join('\n');

	assert.equal(formatMarkdown(markdown, SPACES), markdown);
});

test('leaves emphasis at the start of a line alone', () => {
	const markdown = ['*italic* text', '**bold** text'].join('\n');

	assert.equal(formatMarkdown(markdown, SPACES), markdown);
});

test('leaves CRLF frontmatter alone', () => {
	// The \r survives splitting on \n, and an unrecognised delimiter would leave
	// the YAML below to be rewritten as a list
	const markdown = ['---', 'aliases:', '    - one', '---', '', '- one', '    - two'].join('\r\n');

	assert.equal(formatMarkdown(markdown, TABS),
		['---', 'aliases:', '    - one', '---', '', '- one', '\t- two'].join('\r\n'));
});

test('closes a fence only on its own delimiter', () => {
	const markdown = [
		'- Code',
		'    - ````markdown',
		'      ```',
		'      * not a bullet',
		'      ```',
		'      ````',
		'    - after',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), [
		'- Code',
		'\t- ````markdown',
		'\t  ```',
		'\t  * not a bullet',
		'\t  ```',
		'\t  ````',
		'\t- after',
	].join('\n'));
});

test('a tilde line does not close a backtick fence', () => {
	const markdown = ['```', '~~~', '* not a bullet', '```'].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('formatting what was already formatted changes nothing', () => {
	// What lets an importer compare a converted note against the file on disk
	const converted = ['---', 'a: 1', '---', '', '* one', '    + two', '        - three'].join('\n');

	for (const output of [TABS, SPACES]) {
		const once = formatMarkdown(converted, output);
		assert.equal(formatMarkdown(once, output), once);
	}
});

test('leaves a CRLF thematic break as it is', () => {
	const markdown = ['- one', '', '* * *', '', '***'].join('\r\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('a fence-like line indented four past its fence is code, not a close', () => {
	const markdown = [
		'```',
		'    ```',
		'* not a bullet',
		'```',
		'* a bullet',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), [
		'```',
		'    ```',
		'* not a bullet',
		'```',
		'- a bullet',
	].join('\n'));
});

test('leaves an indented code block inside a list item literal', () => {
	// Four past the item's text is code, and "* literal" is a line of it
	const markdown = [
		'- one',
		'',
		'      * literal',
		'      + literal',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('still nests a sub-item that follows a blank line', () => {
	assert.equal(
		formatMarkdown(['- one', '    - two', '', '        - three'].join('\n'), TABS),
		['- one', '\t- two', '', '\t\t- three'].join('\n'));
});
