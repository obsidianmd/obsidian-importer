import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

import {
	extractPageProperties,
	removeLeftoverBlockProperties,
	convertHeadingProperty,
} from '../../src/formats/logseq/properties';

function parseFrontmatter(yaml: string): Record<string, unknown> {
	return parse(yaml.split('\n').slice(1, -1).join('\n')) as Record<string, unknown>;
}

test('returns empty yaml when there are no page properties', () => {
	const { yaml, body } = extractPageProperties('- just a block\n- another');
	assert.equal(yaml, '');
	assert.equal(body, '- just a block\n- another');
});

test('parses simple scalar properties into frontmatter', () => {
	const input = 'type:: book\nauthor:: Jane\n\n- content';
	const { yaml, body } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'type: book', 'author: Jane', '---'].join('\n'));
	assert.equal(body, '- content');
});

test('alias and aliases map to an aliases list and strip wikilink brackets', () => {
	const input = 'alias:: ML, [[Machine Learning]]\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'aliases:', '  - ML', '  - Machine Learning', '---'].join('\n'));
});

test('quotes YAML-sensitive alias list items', () => {
	const { yaml } = extractPageProperties('alias:: [[Project: Alpha]], #draft\n\ntext');
	assert.deepEqual(parseFrontmatter(yaml).aliases, ['Project: Alpha', '#draft']);
});

test('tags property strips # and wikilinks and becomes a list', () => {
	const input = 'tags:: #foo, [[bar baz]], qux\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'tags:', '  - foo', '  - bar baz', '  - qux', '---'].join('\n'));
});

test('tags property handles a value mixing wikilinks and hashtags without commas', () => {
	const input = 'tags:: tag1, [[tag2]] #tag3\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'tags:', '  - tag1', '  - tag2', '  - tag3', '---'].join('\n'));
});

test('title is registered as an alias and returned in raw', () => {
	const input = 'title:: My Title\ntype:: note\n\ntext';
	const { yaml, raw } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'aliases:', '  - My Title', 'type: note', '---'].join('\n'));
	assert.equal(raw.title, 'My Title');
});

test('wikilink-valued scalar property is quoted', () => {
	const input = 'project:: [[Big Project]]\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'project: "[[Big Project]]"', '---'].join('\n'));
});

test('multiple wikilink values become a quoted list', () => {
	const input = 'related:: [[A]], [[B]]\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'related:', '  - "[[A]]"', '  - "[[B]]"', '---'].join('\n'));
});

test('configured comma-separated properties become YAML lists', () => {
	const input = 'authors:: Alice, Bob\n\ntext';
	const { yaml } = extractPageProperties(input, {
		commaSeparatedProperties: new Set(['authors']),
	});
	assert.deepEqual(parseFrontmatter(yaml).authors, ['Alice', 'Bob']);
});

test('property block ends at the first non-property line', () => {
	const input = 'type:: note\nthis is content:: not a prop line really\nmore';
	const { yaml, body } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
	assert.equal(body, 'this is content:: not a prop line really\nmore');
});

test('a file that starts with a bullet has no page properties', () => {
	const input = '- title:: not a page property\n- x';
	const { yaml, body } = extractPageProperties(input);
	assert.equal(yaml, '');
	assert.equal(body, input);
});

test('removeLeftoverBlockProperties strips logseq-internal block props', () => {
	const input = [
		'- a block',
		'  collapsed:: true',
		'  logseq.order-list-type:: number',
		'- another',
		'  background-color:: red',
		'  query-sort-by:: created',
	].join('\n');
	const out = removeLeftoverBlockProperties(input);
	assert.equal(out, ['- a block', '- another'].join('\n'));
});

test('removeLeftoverBlockProperties keeps unknown user block properties', () => {
	const input = ['- a block', '  rating:: 5'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), input);
});

test('[I1] always-drop keys are removed', () => {
	const input = [
		'- a block',
		'  collapsed:: true',
		'  logseq.order-list-type:: number',
		'  hl-color:: yellow',
	].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- a block');
});

test('[I1] property-like lines inside code fences are unchanged', () => {
	const input = ['- a block', '  ```', '  key:: value', '  ```'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), input);
});

test('[I1] property-like text after inline code is not treated as a line start', () => {
	const input = '- See `x` key:: value';
	assert.equal(removeLeftoverBlockProperties(input), input);
});

test('extractPageProperties drops Logseq-internal page properties', () => {
	const input = 'type:: note\npublic:: true\nexclude-from-graph-view:: true\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] icon page property is dropped from frontmatter by default', () => {
	const input = 'type:: note\nicon:: \uEAE5\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('extractPageProperties drops listed tags from frontmatter tags list', () => {
	const input = 'tags:: foo, card, bar\n\ntext';
	const { yaml } = extractPageProperties(input, { dropTags: ['card'] });
	assert.equal(yaml, ['---', 'tags:', '  - foo', '  - bar', '---'].join('\n'));
});

test('extractPageProperties produces no frontmatter when all tags are dropped', () => {
	const input = 'tags:: card\n\ntext';
	const { yaml } = extractPageProperties(input, { dropTags: ['card'] });
	assert.equal(yaml, '');
});

test('convertHeadingProperty turns heading:: N into a markdown heading prefix', () => {
	const input = ['- Important section', '  heading:: 2', '- normal'].join('\n');
	const out = convertHeadingProperty(input);
	assert.equal(out, ['- ## Important section', '- normal'].join('\n'));
});

test('convertHeadingProperty leaves heading:: true (auto) handling without crashing', () => {
	const input = ['- A', '  heading:: true'].join('\n');
	assert.equal(convertHeadingProperty(input), '- A');
});

test('convertHeadingProperty associates a property after inline code with its whole bullet', () => {
	const input = ['- Heading with `code`', '  heading:: 2'].join('\n');
	assert.equal(convertHeadingProperty(input), '- ## Heading with `code`');
});


test('[I1] scalar value starting with # is quoted', () => {
	const { yaml } = extractPageProperties('status:: #in-progress\n\ntext');
	assert.equal(yaml, ['---', 'status: "#in-progress"', '---'].join('\n'));
});

test('quotes a property value containing an inline tag', () => {
	const { yaml } = extractPageProperties('status:: doing #urgent\n\ntext');
	assert.equal(parseFrontmatter(yaml).status, 'doing #urgent');
});

test('quotes a property value starting with a YAML sequence indicator', () => {
	const { yaml } = extractPageProperties('description:: - item\n\ntext');
	assert.equal(parseFrontmatter(yaml).description, '- item');
});

test('[I1] scalar value that is a markdown link is quoted', () => {
	const { yaml } = extractPageProperties('file:: [doc](../a/b.pdf)\n\ntext');
	assert.equal(yaml, ['---', 'file: "[doc](../a/b.pdf)"', '---'].join('\n'));
});

test('[I1] comma inside a single wikilink is not split into a list', () => {
	const { yaml } = extractPageProperties('deadline:: [[Jul 18th, 2025]]\n\ntext');
	assert.equal(yaml, ['---', 'deadline: "[[Jul 18th, 2025]]"', '---'].join('\n'));
});

test('[I1] colon-space value is quoted', () => {
	const { yaml } = extractPageProperties('k:: value: with colon\n\nx');
	assert.equal(yaml, ['---', 'k: "value: with colon"', '---'].join('\n'));
});

test('[I1] boolean-like value stays a quoted string', () => {
	const { yaml } = extractPageProperties('k:: yes\n\nx');
	assert.equal(yaml, ['---', 'k: "yes"', '---'].join('\n'));
});

test('[I1] leading-zero numeric value stays a quoted string', () => {
	const { yaml } = extractPageProperties('k:: 007\n\nx');
	assert.equal(yaml, ['---', 'k: "007"', '---'].join('\n'));
});

test('[I1] internal block property written as a bullet is stripped', () => {
	const input = ['- a block', '- collapsed:: true', '- next'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), ['- a block', '- next'].join('\n'));
});

test('[I1] PDF highlight props (ls-type / hl-*) are dropped', () => {
	const input = ['- quote', '  ls-type:: annotation', '  hl-page:: 46', '  hl-color:: yellow'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- quote');
});

test('[I1] title page property is preserved as an alias', () => {
	const { yaml, raw } = extractPageProperties('title:: Example Title\ntype:: note\n\ntext');
	assert.equal(raw.title, 'Example Title');
	assert.match(yaml, /aliases:\n {2}- Example Title/);
});

test('[I1] created wikilink date is emitted as a plain ISO date', () => {
	const { yaml } = extractPageProperties('created:: [[2024-01-16]]\n\nx');
	assert.equal(yaml, ['---', 'created: 2024-01-16', '---'].join('\n'));
});

test('[I1] empty-valued page property is omitted', () => {
	const { yaml } = extractPageProperties('icon::\n\nx');
	assert.equal(yaml, '');
});

test('[I1] duplicate page-property keys are de-duplicated (last wins)', () => {
	const { yaml } = extractPageProperties('type:: a\ntype:: b\n\nx');
	assert.equal(yaml, ['---', 'type: b', '---'].join('\n'));
});

test('[I1] collapsed page property is always dropped from frontmatter', () => {
	const { yaml } = extractPageProperties('collapsed:: true\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] filters page property is always dropped from frontmatter', () => {
	const { yaml } = extractPageProperties('filters:: {}\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] background-color page property is always dropped from frontmatter', () => {
	const { yaml } = extractPageProperties('background-color:: red\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] heading page property is always dropped from frontmatter', () => {
	const { yaml } = extractPageProperties('heading:: true\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] template and template-including-parent page properties are always dropped', () => {
	const { yaml } = extractPageProperties('template:: My Template\ntemplate-including-parent:: false\n\ntext');
	assert.equal(yaml, '');
});

test('[I1] query-* prefixed page properties are always dropped', () => {
	const { yaml } = extractPageProperties('query-table:: true\nquery-sort-by:: created\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] logseq.* prefixed page properties are always dropped', () => {
	const { yaml } = extractPageProperties('logseq.order-list-type:: number\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] hl-* and ls-* prefixed page properties are always dropped', () => {
	const { yaml } = extractPageProperties('hl-page:: 42\nls-type:: annotation\ntype:: note\n\ntext');
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});


test('[I1] alias block property is always dropped', () => {
	const input = ['- a block', '  alias:: Some Alias'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- a block');
});

test('[I1] template block property is always dropped', () => {
	const input = ['- a block', '  template:: My Template'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- a block');
});

test('[I1] template-including-parent block property is always dropped', () => {
	const input = ['- a block', '  template-including-parent:: false'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- a block');
});


test('page properties keep kebab-case keys', () => {
	const input = 'test-hyphen:: value\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'test-hyphen: value', '---'].join('\n'));
});

test('block properties keep kebab-case keys', () => {
	const input = ['- a block', '  test-hyphen:: value'].join('\n');
	const out = removeLeftoverBlockProperties(input);
	assert.equal(out, input);
});
