import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	toWhitelist,
	findUnsupportedWhitelistPatterns,
	matchesAttachmentWhitelist,
} from '../../src/formats/onenote/attachment-whitelist';

// toWhitelist

test('toWhitelist converts extensions to *.ext glob patterns joined by commas', () => {
	assert.equal(toWhitelist(['png', 'jpg', 'pdf']), '*.png, *.jpg, *.pdf');
});

test('toWhitelist returns empty string for empty array', () => {
	assert.equal(toWhitelist([]), '');
});

test('toWhitelist handles a single extension', () => {
	assert.equal(toWhitelist(['pdf']), '*.pdf');
});

// findUnsupportedWhitelistPatterns

test('findUnsupportedWhitelistPatterns returns empty array for blank whitelist', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns(''), []);
});

test('findUnsupportedWhitelistPatterns returns empty array when all patterns are valid', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('*, *.png, report.pdf, file'), []);
});

test('findUnsupportedWhitelistPatterns accepts * wildcard', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('*'), []);
});

test('findUnsupportedWhitelistPatterns accepts *.ext patterns', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('*.png, *.tar.gz'), []);
});

test('findUnsupportedWhitelistPatterns accepts plain filenames', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('report.pdf, file'), []);
});

test('findUnsupportedWhitelistPatterns flags ** glob patterns', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('**/*.png'), ['**/*.png']);
});

test('findUnsupportedWhitelistPatterns flags ? wildcard patterns', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('file?.txt'), ['file?.txt']);
});

test('findUnsupportedWhitelistPatterns flags *. with no extension', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('*.'), ['*.']);
});

test('findUnsupportedWhitelistPatterns returns only unsupported patterns from a mixed whitelist', () => {
	assert.deepEqual(
		findUnsupportedWhitelistPatterns('*.png, **/*.jpg, file?.txt, *'),
		['**/*.jpg', 'file?.txt']
	);
});

test('findUnsupportedWhitelistPatterns ignores empty entries from extra commas', () => {
	assert.deepEqual(findUnsupportedWhitelistPatterns('*.png,,  ,**/*.jpg'), ['**/*.jpg']);
});

// matchesAttachmentWhitelist

test('matchesAttachmentWhitelist returns false for empty whitelist', () => {
	assert.equal(matchesAttachmentWhitelist('file.pdf', ''), false);
});

test('matchesAttachmentWhitelist returns false for whitespace-only whitelist', () => {
	assert.equal(matchesAttachmentWhitelist('file.pdf', '   '), false);
});

test('matchesAttachmentWhitelist * matches any filename', () => {
	assert.equal(matchesAttachmentWhitelist('file.exe', '*'), true);
	assert.equal(matchesAttachmentWhitelist('anything.123', '*'), true);
});

test('matchesAttachmentWhitelist *.ext matches filename with that extension', () => {
	assert.equal(matchesAttachmentWhitelist('photo.jpg', '*.jpg'), true);
	assert.equal(matchesAttachmentWhitelist('document.pdf', '*.pdf'), true);
});

test('matchesAttachmentWhitelist *.ext does not match a different extension', () => {
	assert.equal(matchesAttachmentWhitelist('photo.png', '*.jpg'), false);
});

test('matchesAttachmentWhitelist *.ext matching is case-insensitive', () => {
	assert.equal(matchesAttachmentWhitelist('Photo.JPG', '*.jpg'), true);
	assert.equal(matchesAttachmentWhitelist('photo.jpg', '*.JPG'), true);
});

test('matchesAttachmentWhitelist matches exact filename', () => {
	assert.equal(matchesAttachmentWhitelist('report.pdf', 'report.pdf'), true);
	assert.equal(matchesAttachmentWhitelist('other.pdf', 'report.pdf'), false);
});

test('matchesAttachmentWhitelist exact filename match is case-insensitive', () => {
	assert.equal(matchesAttachmentWhitelist('Report.PDF', 'report.pdf'), true);
});

test('matchesAttachmentWhitelist returns true when any pattern in the list matches', () => {
	assert.equal(matchesAttachmentWhitelist('file.pdf', '*.png, *.pdf, *.jpg'), true);
	assert.equal(matchesAttachmentWhitelist('file.exe', '*.png, *.pdf, *.jpg'), false);
});

test('matchesAttachmentWhitelist handles extra whitespace around patterns', () => {
	assert.equal(matchesAttachmentWhitelist('file.pdf', '  *.pdf  ,  *.png  '), true);
});

test('matchesAttachmentWhitelist ignores empty entries from extra commas', () => {
	assert.equal(matchesAttachmentWhitelist('file.pdf', '*.png,,*.pdf'), true);
});
