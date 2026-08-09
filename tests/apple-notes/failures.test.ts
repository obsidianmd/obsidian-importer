/**
 * What the folder picker says when the notes database will not open.
 *
 * The vendored sqlite layer fails in two shapes, and both are covered here.
 * Its error helper labels the message SQLITE_ERROR and sets a matching code
 * (sqlite/utils.js), but the persistent path rejects with a plain Error
 * carrying the raw stderr and no code at all (sqlite/index.js). An earlier
 * version of this branched on ENOENT and EACCES, which read plausibly and
 * could never fire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeFolderFailure } from '../../src/formats/apple-notes';

/** What the error helper in sqlite/utils.js builds. */
function sqliteError(reason: string): Error {
	return Object.assign(new Error(`SQLITE_ERROR: ${reason}`), { code: 'SQLITE_ERROR' });
}

/** What the persistent path in sqlite/index.js rejects with: stderr, no code. */
function stderrError(reason: string): Error {
	return new Error(reason);
}

test('a database Notes still has open says to quit Notes', () => {
	for (const reason of ['busy DB or query too slow', 'database is locked']) {
		assert.match(describeFolderFailure(sqliteError(reason)), /Quit Notes/, `labelled: ${reason}`);
		assert.match(describeFolderFailure(stderrError(reason)), /Quit Notes/, `bare: ${reason}`);
	}
});

test('a bare stderr rejection is described the same as a labelled one', () => {
	// Nothing may strip a prefix that is not there, or lose the message for
	// want of a code.
	assert.match(describeFolderFailure(stderrError('unable to open database file')), /Could not open your Apple Notes database/);
	assert.equal(
		describeFolderFailure(stderrError('no such table: ZICCLOUDSYNCINGOBJECT')),
		'Could not read your notes: no such table: ZICCLOUDSYNCINGOBJECT',
	);
});

test('a database that will not open points at the access hint', () => {
	const message = describeFolderFailure(sqliteError('unable to open database file'));

	assert.match(message, /Could not open your Apple Notes database/);
	assert.match(message, /Allow access to your notes/);
});

test('anything else repeats what sqlite said, without its label', () => {
	const message = describeFolderFailure(sqliteError('no such table: ZICCLOUDSYNCINGOBJECT'));

	assert.equal(message, 'Could not read your notes: no such table: ZICCLOUDSYNCINGOBJECT');
});

test('an error with nothing to say still names what failed', () => {
	assert.equal(describeFolderFailure(new Error('')), 'Could not read your notes.');
	assert.equal(describeFolderFailure(sqliteError('')), 'Could not read your notes.');
});
