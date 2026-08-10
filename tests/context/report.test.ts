/**
 * What an import writes down about the notes it could not bring over.
 *
 * The progress log is gone the moment the dialog closes, which for a ten
 * thousand page workspace leaves five numbers and nothing to act on: not which
 * pages failed, not why, not whether the skipped ones were the ones already in
 * the vault. Building the text needs no vault, so this checks what it says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImportContext } from '../../src/import-context';
import { formatImportReport } from '../../src/import-report';

const WHEN = new Date(2026, 7, 9, 14, 32);

function reportOf(ctx: ImportContext, overrides: Partial<Parameters<typeof formatImportReport>[0]> = {}): string {
	return formatImportReport({
		importer: 'Notion (API)',
		when: WHEN,
		notes: ctx.notes,
		attachments: ctx.attachments,
		cancelled: ctx.isCancelled(),
		log: ctx.log,
		...overrides,
	});
}

test('a failure keeps the whole reason, however long it is', () => {
	const ctx = new ImportContext();
	const path = '/Users/someone/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault/Notion/Multitenant Architecture/In a single-tenant setup, a SaaS application is uniquely deployed.md';
	ctx.reportFailed('In a single-tenant setup, a SaaS application', `ENAMETOOLONG: name too long, open '${path}'`);

	const report = reportOf(ctx);

	// The path is the whole point of the entry: the log used to stop at a
	// hundred characters, which is a few short of where it starts.
	assert.ok(report.includes(path), report);
	assert.match(report, /^## Failed \(1\)$/m);
});

test('an entry is one line, whatever the name had in it', () => {
	const ctx = new ImportContext();
	ctx.reportFailed('A title\nsplit over\nlines', 'HTTP 502');

	const lines = reportOf(ctx).split('\n').filter(line => line.startsWith('- '));

	assert.deepEqual(lines, ['- "A title split over lines" because HTTP 502']);
});

test('failures come before the skips, which are the ones with nothing to do about them', () => {
	const ctx = new ImportContext();
	ctx.reportSkipped('Aftersun', 'it is already in the vault');
	ctx.reportFailed('Parasite', 'HTTP 502');

	const report = reportOf(ctx);

	assert.ok(report.indexOf('## Failed') < report.indexOf('## Skipped'), report);
});

test('the counts say what the import did as well as what it did not', () => {
	const ctx = new ImportContext();
	ctx.notes = 10544;
	ctx.attachments = 6823;
	ctx.reportFailed('Parasite', 'HTTP 502');
	ctx.reportSkipped('Aftersun', 'it is already in the vault');
	ctx.reportSkipped('Moonlight', 'it is already in the vault');

	assert.match(
		reportOf(ctx),
		// A count goes through toLocaleString in the chosen language, so the
		// separator is the language's rather than the machine's
		/Finished 2026-08-09 14:32\. 10,544 notes imported, 6,823 attachments downloaded, 2 items skipped, 1 item failed\./
	);
});

/**
 * Not every importer reports a note success - the Notion API one counts
 * progress through the pages it was given instead - so a count of zero is as
 * likely to mean "not counted" as "none", and claiming it over a folder full
 * of imported notes is worse than saying nothing.
 */
test('a count the import never kept is left out rather than written as zero', () => {
	const ctx = new ImportContext();
	ctx.reportSkipped('Aftersun', 'it is already in the vault');

	const summary = reportOf(ctx).split('\n')[2];

	assert.equal(summary, 'Finished 2026-08-09 14:32. 1 item skipped.');
});

test('an import that was stopped says so rather than claiming to have finished', () => {
	const ctx = new ImportContext();
	ctx.reportFailed('Parasite', 'HTTP 502');
	ctx.cancel();

	assert.match(reportOf(ctx), /^Stopped 2026-08-09 14:32\./m);
});

test('a section too long to read says how much of it is missing', () => {
	const ctx = new ImportContext();
	for (let i = 0; i < 5003; i++) ctx.reportSkipped(`Page ${i}`, 'it is already in the vault');

	const report = reportOf(ctx);

	assert.match(report, /^## Skipped \(5,003\)$/m, 'the count should be the real one');
	assert.equal(report.split('\n').filter(line => line.startsWith('- ')).length, 5000);
	assert.match(report, /_3 more not listed/);
});

test('a reason nobody passed is left off rather than written as undefined', () => {
	const ctx = new ImportContext();
	ctx.reportSkipped('Aftersun');

	const lines = reportOf(ctx).split('\n').filter(line => line.startsWith('- '));

	assert.deepEqual(lines, ['- "Aftersun"']);
});

/**
 * reportSkipped and reportFailed used to count and then forget, which is why
 * nothing outlived the dialog.
 */
test('the context keeps the reason alongside the name', () => {
	const ctx = new ImportContext();
	ctx.reportFailed('Parasite', new Error('HTTP 502'));

	assert.deepEqual(ctx.failed, ['Parasite']);
	assert.equal(ctx.log.length, 1);
	assert.equal(ctx.log[0].outcome, 'failed');
	assert.equal((ctx.log[0].reason as Error).message, 'HTTP 502');
});
