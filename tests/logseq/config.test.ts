import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultLogseqConfig, parseLogseqConfig } from '../../src/formats/logseq/config';

test('parses the Markdown graph settings used by the importer', () => {
	const config = parseLogseqConfig([
		'{:pages-directory "notes/library"',
		' :journals-directory "daily"',
		' :whiteboards-directory "boards"',
		' :file/name-format :triple-lowbar',
		' :journal/file-name-format "dd-MM-yyyy"',
		' :journal/page-title-format "dd MMM yyyy"',
		' :property/separated-by-commas #{:authors :people}}',
	].join('\n'));

	assert.equal(config.pagesDirectory, 'notes/library');
	assert.equal(config.journalsDirectory, 'daily');
	assert.equal(config.whiteboardsDirectory, 'boards');
	assert.equal(config.filenameFormat, 'triple-lowbar');
	assert.equal(config.journalFileNameFormat, 'dd-MM-yyyy');
	assert.equal(config.journalPageTitleFormat, 'dd MMM yyyy');
	assert.deepEqual([...config.commaSeparatedProperties], ['authors', 'people']);
});

test('ignores comments and similarly named values in nested data', () => {
	const config = parseLogseqConfig([
		'{;; :pages-directory "commented"',
		' :default-home {:pages-directory "nested"}',
		' :pages-directory "actual;notes"}',
	].join('\n'));

	assert.equal(config.pagesDirectory, 'actual;notes');
});

test('uses legacy filenames when an existing config omits the newer setting', () => {
	assert.equal(parseLogseqConfig('{:meta/version 1}').filenameFormat, 'legacy');
});

test('keeps the existing tolerant fallback when config.edn is absent', () => {
	assert.equal(defaultLogseqConfig().filenameFormat, 'triple-lowbar');
});
