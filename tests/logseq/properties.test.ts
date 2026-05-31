import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	extractPageProperties,
	removeLeftoverBlockProperties,
	convertHeadingProperty,
} from '../../src/formats/logseq/properties';

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

test('title is dropped from yaml but returned in raw', () => {
	const input = 'title:: My Title\ntype:: note\n\ntext';
	const { yaml, raw } = extractPageProperties(input);
	assert.equal(yaml, ['---', 'type: note', '---'].join('\n'));
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
	// "this is content:: ..." has a space in the key position so it is not a valid property line.
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

test('convertHeadingProperty turns heading:: N into a markdown heading prefix', () => {
	const input = ['- Important section', '  heading:: 2', '- normal'].join('\n');
	const out = convertHeadingProperty(input);
	assert.equal(out, ['- ## Important section', '- normal'].join('\n'));
});

test('convertHeadingProperty leaves heading:: true (auto) handling without crashing', () => {
	const input = ['- A', '  heading:: true'].join('\n');
	// auto-heading has no explicit level; we just drop the property line.
	assert.equal(convertHeadingProperty(input), '- A');
});
