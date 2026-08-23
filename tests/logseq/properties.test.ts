import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

import {
	extractPageProperties,
	removeLeftoverBlockProperties,
	convertHeadingProperty,
	linkifyTagValuesInFrontmatter,
} from '../../src/formats/logseq/properties';
import { DEFAULT_DROP_PAGE_PROPERTIES } from '../../src/formats/logseq/options';

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

test('removeLeftoverBlockProperties drops user-specified extra keys', () => {
	const input = ['- a block', '  my-status:: draft', '  rating:: 5'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, ['my-status']), ['- a block', '  rating:: 5'].join('\n'));
});

test('[I1] keep mode leaves unknown block property unchanged', () => {
	const input = ['- a block', '  rating:: 5'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, [], 'keep'), input);
});

test('[I1] wrap mode rewrites participants:: … into [participants:: …]', () => {
	const input = ['- a block', '  participants:: [[Alice]], [[Bob]]'].join('\n');
	assert.equal(
		removeLeftoverBlockProperties(input, [], 'wrap'),
		['- a block', '  [participants:: [[Alice]], [[Bob]]]'].join('\n'),
	);
});

test('[I1] wrap mode preserves indentation and trailing ^anchor', () => {
	const input = ['- a block', '\t  participants:: a, b ^abc123'].join('\n');
	assert.equal(
		removeLeftoverBlockProperties(input, [], 'wrap'),
		['- a block', '\t  [participants:: a, b] ^abc123'].join('\n'),
	);
});

test('[I1] drop mode removes the line', () => {
	const input = ['- a block', '  rating:: 5'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, [], 'drop'), '- a block');
});

test('[I1] always-drop keys ignore the mode (collapsed/logseq.*/hl-* still dropped in keep & wrap)', () => {
	const input = [
		'- a block',
		'  collapsed:: true',
		'  logseq.order-list-type:: number',
		'  hl-color:: yellow',
	].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, [], 'keep'), '- a block');
	assert.equal(removeLeftoverBlockProperties(input, [], 'wrap'), '- a block');
});

test('[I1] value containing ] falls back to keep', () => {
	const input = ['- a block', '  note:: foo] bar'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, [], 'wrap'), input);
});

test('[I1] wrap mode does not touch property-like lines inside code fences', () => {
	const input = ['- a block', '  ```', '  key:: value', '  ```'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, [], 'wrap'), input);
});

test('[I1] property-like text after inline code is not treated as a line start', () => {
	const input = '- See `x` key:: value';
	assert.equal(removeLeftoverBlockProperties(input, [], 'wrap'), input);
});

test('extractPageProperties drops listed page property keys from frontmatter', () => {
	const input = 'type:: note\npublic:: true\nmy-key:: val\n\ntext';
	const { yaml } = extractPageProperties(input, { dropPageProperties: ['public', 'my-key'] });
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] icon page property is dropped from frontmatter by default', () => {
	const input = 'type:: note\nicon:: \uEAE5\n\ntext';
	const { yaml } = extractPageProperties(input, { dropPageProperties: DEFAULT_DROP_PAGE_PROPERTIES });
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[I1] icon is retained when removed from the drop list', () => {
	const input = 'type:: note\nicon:: star\n\ntext';
	const { yaml } = extractPageProperties(input, { dropPageProperties: [] });
	assert.equal(yaml, ['---', 'type: note', 'icon: star', '---'].join('\n'));
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

test('[I1] tag value linkifies to [[page]] when page exists and toLinks on', () => {
	const yaml = ['---', 'status: "#IN-PROGRESS"', '---'].join('\n');
	const out = linkifyTagValuesInFrontmatter(yaml, {
		knownPages: new Set(['in-progress']),
		toLinks: true,
		onlyExistingPages: true,
	});
	assert.equal(out, ['---', 'status: "[[IN-PROGRESS]]"', '---'].join('\n'));
});

test('[I1] multi-word #[[tag]] value linkifies to [[tag]]', () => {
	const yaml = ['---', 'area: "#[[Page One]]"', '---'].join('\n');
	const out = linkifyTagValuesInFrontmatter(yaml, {
		knownPages: new Set(['page one']),
		toLinks: true,
		onlyExistingPages: true,
	});
	assert.equal(out, ['---', 'area: "[[Page One]]"', '---'].join('\n'));
});

test('[I1] tag value stays quoted text when no matching page (onlyExistingPages)', () => {
	const yaml = ['---', 'status: "#IN-PROGRESS"', '---'].join('\n');
	const out = linkifyTagValuesInFrontmatter(yaml, {
		knownPages: new Set(),
		toLinks: true,
		onlyExistingPages: true,
	});
	assert.equal(out, yaml);
});

test('[I1] tag value stays quoted text when toLinks is off (default)', () => {
	const yaml = ['---', 'status: "#IN-PROGRESS"', '---'].join('\n');
	const out = linkifyTagValuesInFrontmatter(yaml, {
		knownPages: new Set(['in-progress']),
		toLinks: false,
		onlyExistingPages: true,
	});
	assert.equal(out, yaml);
});

test('[I1] tags: list is unaffected', () => {
	const yaml = ['---', 'tags:', '  - foo', '  - bar', '---'].join('\n');
	const out = linkifyTagValuesInFrontmatter(yaml, {
		knownPages: new Set(['foo', 'bar']),
		toLinks: true,
		onlyExistingPages: true,
	});
	assert.equal(out, yaml);
});

test('[I1] tag value linkifies regardless of page set when onlyExistingPages is off', () => {
	const yaml = ['---', 'area: "#security"', '---'].join('\n');
	const out = linkifyTagValuesInFrontmatter(yaml, {
		knownPages: new Set(),
		toLinks: true,
		onlyExistingPages: false,
	});
	assert.equal(out, ['---', 'area: "[[security]]"', '---'].join('\n'));
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


test('[I1] alias block property is always dropped (not wrapped or kept)', () => {
	const input = ['- a block', '  alias:: Some Alias'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input, [], 'keep'), '- a block');
	assert.equal(removeLeftoverBlockProperties(input, [], 'wrap'), '- a block');
	assert.equal(removeLeftoverBlockProperties(input, [], 'drop'), '- a block');
});

test('[I1] template block property is always dropped', () => {
	const input = ['- a block', '  template:: My Template'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- a block');
});

test('[I1] template-including-parent block property is always dropped', () => {
	const input = ['- a block', '  template-including-parent:: false'].join('\n');
	assert.equal(removeLeftoverBlockProperties(input), '- a block');
});


test('[T-snake] snakeCasePageProperties converts kebab-case keys to snake_case', () => {
	const input = 'test-hyphen:: value\ntype:: note\n\ntext';
	const { yaml } = extractPageProperties(input, { snakeCasePageProperties: true });
	assert.equal(yaml, ['---', 'test_hyphen: value', 'type: note', '---'].join('\n'));
});

test('[T-snake] page properties keep kebab-case keys by default', () => {
	const input = 'test-hyphen:: value\n\ntext';
	const { yaml } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'test-hyphen: value', '---'].join('\n'));
});

test('[T-snake] snakeCasePageProperties does not affect drop-list matching (kebab key still dropped)', () => {
	const input = 'test-hyphen:: value\ntype:: note\n\ntext';
	const { yaml } = extractPageProperties(input, {
		snakeCasePageProperties: true,
		dropPageProperties: ['test-hyphen'],
	});
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
});

test('[T-snake] snakeCasePageProperties works with list-valued properties', () => {
	const input = 'multi-word:: [[Page One]], [[Page Two]]\n\ntext';
	const { yaml } = extractPageProperties(input, { snakeCasePageProperties: true });
	assert.equal(yaml, ['---', 'multi_word:', '  - "[[Page One]]"', '  - "[[Page Two]]"', '---'].join('\n'));
});

test('[T-snake] snakeCaseBlockProperties converts kebab-case keys in keep mode', () => {
	const input = ['- a block', '  test-hyphen:: value'].join('\n');
	const out = removeLeftoverBlockProperties(input, [], 'keep', true);
	assert.equal(out, ['- a block', '  test_hyphen:: value'].join('\n'));
});

test('[T-snake] snakeCaseBlockProperties converts kebab-case keys in wrap mode', () => {
	const input = ['- a block', '  test-hyphen:: value'].join('\n');
	const out = removeLeftoverBlockProperties(input, [], 'wrap', true);
	assert.equal(out, ['- a block', '  [test_hyphen:: value]'].join('\n'));
});

test('[T-snake] block properties keep kebab-case keys by default', () => {
	const input = ['- a block', '  test-hyphen:: value'].join('\n');
	const out = removeLeftoverBlockProperties(input, [], 'keep');
	assert.equal(out, input);
});

test('[T-snake] snakeCaseBlockProperties preserves trailing block anchor', () => {
	const input = ['- a block', '  test-hyphen:: value ^abc123'].join('\n');
	const out = removeLeftoverBlockProperties(input, [], 'keep', true);
	assert.equal(out, ['- a block', '  test_hyphen:: value ^abc123'].join('\n'));
});

test('[T-snake] snakeCaseBlockProperties does not affect always-drop or user drop-list matching', () => {
	const input = ['- a block', '  background-color:: red', '  custom-key:: val'].join('\n');
	const out = removeLeftoverBlockProperties(input, ['custom-key'], 'keep', true);
	assert.equal(out, '- a block');
});
