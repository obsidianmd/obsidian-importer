/**
 * The pass that puts every importer's markdown in the vault's form.
 *
 * Checked here rather than in a recording, which would have to pick one vault
 * to be recorded against.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMarkdown, standardizedMarkdown, standardizeMarkdownFile } from '../../src/markdown-output';
import { MemoryVault } from '../shims/vault';

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

test('an outdented fence cannot close a fence that was inside a list', () => {
	const markdown = [
		'- item',
		'  ```',
		'  code',
		'```',
		'* literal',
		'```',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), markdown);
});

test('restores the parent item before recognizing its indented code', () => {
	const markdown = [
		'- one',
		'    - two',
		'  parent continuation',
		'',
		'      * literal',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), [
		'- one',
		'\t- two',
		'  parent continuation',
		'',
		'      * literal',
	].join('\n'));
});

test('writes resolved links with Obsidian link settings after targets exist', async () => {
	const markdown = 'See [[Folder/Target#Heading|label]] and ![[assets/image.png]].';
	const link = '[[Folder/Target#Heading|label]]';
	const embed = '![[assets/image.png]]';
	const at = (text: string) => {
		const start = markdown.indexOf(text);
		return { start: { offset: start }, end: { offset: start + text.length } };
	};
	const target = { path: 'Folder/Target.md' };
	const image = { path: 'assets/image.png' };
	const app = {
		vault: { getConfig: () => false },
		metadataCache: {
			computeMetadataAsync: async () => ({
				links: [{ link: 'Folder/Target#Heading', displayText: 'label', position: at(link) }],
				embeds: [{ link: 'assets/image.png', position: at(embed) }],
			}),
			getFirstLinkpathDest: (path: string) => path === 'Folder/Target' ? target : image,
		},
		fileManager: {
			generateMarkdownLink: (file: typeof target, _source: string, subpath = '', alias = '') =>
				`[${alias}](${file.path}${subpath})`,
		},
	} as never;

	assert.equal(await standardizedMarkdown(app, 'Imported/Note.md', markdown),
		'See [label](Folder/Target.md#Heading) and ![](assets/image.png).');
});

test('does not apply cached link offsets to newly formatted content', async () => {
	const vault = new MemoryVault();
	vault.config.set('useTab', true);
	const file = await vault.create('Note.md', '- one\n    - two\n\nSee [[Target]].');
	let readStaleCache = false;
	const app = {
		vault,
		metadataCache: {
			getFileCache: () => {
				readStaleCache = true;
				return { links: [{ link: 'Target', position: { start: { offset: 27 }, end: { offset: 37 } } }] };
			},
		},
		fileManager: {},
	} as never;

	await standardizeMarkdownFile(app, file as never);

	assert.equal(await vault.read(file), '- one\n\t- two\n\nSee [[Target]].');
	assert.equal(readStaleCache, false);
});

test('a blank line does not end a fence inside a list item', () => {
	const markdown = [
		'- item',
		'  ```js',
		'  const a = 1;',
		'',
		'  * not a bullet',
		'  ```',
		'* after',
	].join('\n');

	assert.equal(formatMarkdown(markdown, TABS), [
		'- item',
		'  ```js',
		'  const a = 1;',
		'',
		'  * not a bullet',
		'  ```',
		'- after',
	].join('\n'));
});
