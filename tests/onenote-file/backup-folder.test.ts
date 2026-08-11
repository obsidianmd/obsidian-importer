/**
 * Finding OneNote's backup folder, driven by a made-up directory tree.
 *
 * The real thing only exists on Windows, and its backup folder is named in the
 * user's language — so the search is written against a listing callback and
 * checked here rather than on a machine none of us has to hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findBackupFolder } from '../../src/formats/onenote-file/backup-folder';

const ROOT = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\OneNote';

/** A tree of directory to entries, listed the way Windows would. */
function probeOf(tree: Record<string, string[]>) {
	return {
		root: ROOT,
		join: (...parts: string[]) => parts.join('\\'),
		list: (directory: string) => tree[directory],
	};
}

test('the backup folder is found whatever its language calls it', () => {
	for (const name of ['Backup', 'Sicherung', 'Sauvegarde', 'Copia de seguridad']) {
		const found = findBackupFolder(probeOf({
			[ROOT]: ['16.0'],
			[`${ROOT}\\16.0`]: [name, 'cache'],
			[`${ROOT}\\16.0\\${name}`]: ['My notebook'],
			[`${ROOT}\\16.0\\${name}\\My notebook`]: ['Quick Notes.one', 'Work.one'],
			[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
		}));

		assert.equal(found, `${ROOT}\\16.0\\${name}`);
	}
});

test('the newest OneNote release is preferred', () => {
	const found = findBackupFolder(probeOf({
		[ROOT]: ['14.0', '16.0', '15.0'],
		[`${ROOT}\\16.0`]: ['Backup'],
		[`${ROOT}\\16.0\\Backup`]: ['New.one'],
		[`${ROOT}\\15.0`]: ['Backup'],
		[`${ROOT}\\15.0\\Backup`]: ['Old.one'],
		[`${ROOT}\\14.0`]: ['Backup'],
		[`${ROOT}\\14.0\\Backup`]: ['Older.one'],
	}));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});

test('a section nested under its notebook is still found', () => {
	const found = findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['Backup'],
		[`${ROOT}\\16.0\\Backup`]: ['Notebook'],
		[`${ROOT}\\16.0\\Backup\\Notebook`]: ['Group'],
		[`${ROOT}\\16.0\\Backup\\Notebook\\Group`]: ['Section.one'],
	}));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});

test('a folder holding no sections is not mistaken for the backup', () => {
	const found = findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['cache', 'Backup'],
		[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
		[`${ROOT}\\16.0\\Backup`]: ['Notebook'],
		[`${ROOT}\\16.0\\Backup\\Notebook`]: ['Section.one'],
	}));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});

test('OneNote installed but with nothing backed up yet opens at its folder', () => {
	const found = findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['cache'],
		[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
	}));

	assert.equal(found, `${ROOT}\\16.0`);
});

test('a machine that has never run OneNote offers nothing', () => {
	assert.equal(findBackupFolder(probeOf({})), undefined);
});

test('an unreadable directory is stepped over rather than thrown on', () => {
	const found = findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['Locked', 'Backup'],
		// "Locked" is absent from the tree, standing for a directory that
		// cannot be listed at all.
		[`${ROOT}\\16.0\\Backup`]: ['Section.one'],
	}));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});
