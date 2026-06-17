import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	extractBearTagsFromContent,
	normalizeBearTagsInMarkdown,
} from '../../src/formats/bear-tags';

test('preserves CJK simple Bear tags during normalization and extraction', () => {
	const content = normalizeBearTagsInMarkdown('#中文 #标签/子标签 #仕事 #일정');

	assert.equal(content, '#中文 #标签/子标签 #仕事 #일정');
	assert.deepEqual(extractBearTagsFromContent(content), [
		'中文',
		'标签/子标签',
		'仕事',
		'일정',
	]);
});

test('flattens nested CJK Bear tags when requested', () => {
	const content = normalizeBearTagsInMarkdown('#标签/子标签');

	assert.deepEqual(extractBearTagsFromContent(content, true), [
		'标签',
		'子标签',
	]);
});

test('keeps existing Latin and diacritic Bear tag behavior', () => {
	const content = normalizeBearTagsInMarkdown('#project #mañana #cafe-au-lait #daily_note');

	assert.deepEqual(extractBearTagsFromContent(content), [
		'project',
		'mañana',
		'cafe-au-lait',
		'daily_note',
	]);
});

test('normalizes enclosed tags and unsupported punctuation', () => {
	const content = normalizeBearTagsInMarkdown('#two words# #中文，标签 #bad!tag');

	assert.equal(content, '#two_words #中文_标签 #bad_tag');
	assert.deepEqual(extractBearTagsFromContent(content), [
		'two_words',
		'中文_标签',
		'bad_tag',
	]);
});
