import { test } from 'node:test';
import assert from 'node:assert/strict';

import { journalFilenameToISO, isJournalFilename, convertJournalDateLinks, reformatDateLinks } from '../../src/formats/logseq/journals';

test('parses default Logseq journal filenames to ISO', () => {
	assert.equal(journalFilenameToISO('2024_08_30'), '2024-08-30');
	assert.equal(journalFilenameToISO('2023_12_03'), '2023-12-03');
	assert.equal(journalFilenameToISO('2024-08-30'), '2024-08-30');
});

test('pads single-digit month and day', () => {
	assert.equal(journalFilenameToISO('2024_8_3'), '2024-08-03');
});

test('returns null for non-journal filenames', () => {
	assert.equal(journalFilenameToISO('Cool Stuff'), null);
	assert.equal(journalFilenameToISO('2024_13_40'), null); // out of range
});

test('isJournalFilename reflects parseability', () => {
	assert.equal(isJournalFilename('2024_08_30'), true);
	assert.equal(isJournalFilename('Some Page'), false);
});

test('converts natural-language date links to ISO wikilinks', () => {
	assert.equal(convertJournalDateLinks('[[Aug 30th, 2024]]'), '[[2024-08-30]]');
	assert.equal(convertJournalDateLinks('[[August 30th, 2024]]'), '[[2024-08-30]]');
	assert.equal(convertJournalDateLinks('see [[Dec 2nd, 2023]] today'), 'see [[2023-12-02]] today');
	assert.equal(convertJournalDateLinks('[[Jan 1st, 2038]]'), '[[2038-01-01]]');
});

test('leaves non-date wikilinks untouched', () => {
	assert.equal(convertJournalDateLinks('[[Machine Learning]]'), '[[Machine Learning]]');
});

test('converts 11th, 12th, 13th ordinals correctly', () => {
	assert.equal(convertJournalDateLinks('[[Mar 11th, 2024]]'), '[[2024-03-11]]');
	assert.equal(convertJournalDateLinks('[[Apr 12th, 2024]]'), '[[2024-04-12]]');
	assert.equal(convertJournalDateLinks('[[May 13th, 2024]]'), '[[2024-05-13]]');
});

test('converts full month names', () => {
	assert.equal(convertJournalDateLinks('[[January 5th, 2024]]'), '[[2024-01-05]]');
	assert.equal(convertJournalDateLinks('[[February 28th, 2024]]'), '[[2024-02-28]]');
	assert.equal(convertJournalDateLinks('[[September 21st, 2024]]'), '[[2024-09-21]]');
	assert.equal(convertJournalDateLinks('[[November 3rd, 2024]]'), '[[2024-11-03]]');
	assert.equal(convertJournalDateLinks('[[December 25th, 2024]]'), '[[2024-12-25]]');
});

test('converts dates without ordinal suffix', () => {
	assert.equal(convertJournalDateLinks('[[Jun 7, 2024]]'), '[[2024-06-07]]');
});

test('handles multiple date links on one line', () => {
	const input = 'from [[Jan 1st, 2024]] to [[Jan 31st, 2024]]';
	assert.equal(convertJournalDateLinks(input), 'from [[2024-01-01]] to [[2024-01-31]]');
});

test('journalFilenameToISO handles dash-separated format', () => {
	assert.equal(journalFilenameToISO('2024-01-15'), '2024-01-15');
});

test('journalFilenameToISO reads a configured Logseq date format', () => {
	assert.equal(journalFilenameToISO('15-06-2024', 'dd-MM-yyyy'), '2024-06-15');
});

test('journalFilenameToISO reads a configured nested date path', () => {
	assert.equal(journalFilenameToISO('2024/06/15', 'yyyy/MM/dd'), '2024-06-15');
});

test('journalFilenameToISO rejects day > 31', () => {
	assert.equal(journalFilenameToISO('2024_01_32'), null);
});

test('journalFilenameToISO rejects month > 12', () => {
	assert.equal(journalFilenameToISO('2024_13_01'), null);
});

test('[E1] reformatDateLinks rewrites the date but preserves a block anchor', () => {
	const fmt = (iso: string) => (iso === '2025-02-20' ? 'Feb 20th, 2025' : null);
	assert.equal(reformatDateLinks('[[2025-02-20#^67bca6]]', fmt), '[[Feb 20th, 2025#^67bca6]]');
});

test('[E1] reformatDateLinks still rewrites a plain date link', () => {
	const fmt = (iso: string) => (iso === '2025-02-20' ? 'Feb 20th, 2025' : null);
	assert.equal(reformatDateLinks('[[2025-02-20]]', fmt), '[[Feb 20th, 2025]]');
});
