/**
 * What the folder picker says when the notes database will not open.
 *
 * The shapes here are the ones the vendored sqlite layer really produces: it
 * labels every failure SQLITE_ERROR and carries the cause in the message,
 * either its own wording or a line of the sqlite3 binary's stderr. An earlier
 * version of this branched on ENOENT and EACCES, which read plausibly and
 * could never fire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeFolderFailure } from '../../src/formats/apple-notes';

/** What src/formats/apple-notes/sqlite/utils.js builds. */
function sqliteError(reason: string): Error {
	return Object.assign(new Error(`SQLITE_ERROR: ${reason}`), { code: 'SQLITE_ERROR' });
}

test('a database Notes still has open says to quit Notes', () => {
	// index.js reports a non-zero exit this way, and the binary's own stderr
	// for the same situation reads differently.
	for (const reason of ['busy DB or query too slow', 'database is locked']) {
		assert.match(describeFolderFailure(sqliteError(reason)), /Quit Notes/, `for ${reason}`);
	}
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
