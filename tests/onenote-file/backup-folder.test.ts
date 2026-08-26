import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findBackupFolder } from '../../src/formats/onenote-file/backup-folder';

const ROOT = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\OneNote';

function probeOf(tree: Record<string, string[]>, unreadable: Set<string> = new Set()) {
	return {
		root: ROOT,
		join: (...parts: string[]) => parts.join('\\'),
		list: async (directory: string) => {
			if (unreadable.has(directory)) return undefined;
			return tree[directory]?.map(name => {
				const path = `${directory}\\${name}`;
				return {
					name,
					isDirectory: unreadable.has(path) || Object.prototype.hasOwnProperty.call(tree, path),
				};
			});
		},
	};
}

test('the backup folder is found whatever its language calls it', async () => {
	for (const name of ['Backup', 'Sicherung', 'Sauvegarde', 'Copia de seguridad']) {
		const found = await findBackupFolder(probeOf({
			[ROOT]: ['16.0'],
			[`${ROOT}\\16.0`]: [name, 'cache'],
			[`${ROOT}\\16.0\\${name}`]: ['My notebook'],
			[`${ROOT}\\16.0\\${name}\\My notebook`]: ['Quick Notes.one', 'Work.one'],
			[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
		}));

		assert.equal(found, `${ROOT}\\16.0\\${name}`);
	}
});

test('the newest OneNote release is preferred', async () => {
	const found = await findBackupFolder(probeOf({
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

test('a section nested under its notebook is still found', async () => {
	const found = await findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['Backup'],
		[`${ROOT}\\16.0\\Backup`]: ['Notebook'],
		[`${ROOT}\\16.0\\Backup\\Notebook`]: ['Group'],
		[`${ROOT}\\16.0\\Backup\\Notebook\\Group`]: ['Section.one'],
	}));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});

test('a folder holding no sections is not mistaken for the backup', async () => {
	const found = await findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['cache', 'Backup'],
		[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
		[`${ROOT}\\16.0\\Backup`]: ['Notebook'],
		[`${ROOT}\\16.0\\Backup\\Notebook`]: ['Section.one'],
	}));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});

test('OneNote installed but with nothing backed up yet opens at its folder', async () => {
	const found = await findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['cache'],
		[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
	}));

	assert.equal(found, `${ROOT}\\16.0`);
});

test('a machine that has never run OneNote offers nothing', async () => {
	assert.equal(await findBackupFolder(probeOf({})), undefined);
});

test('an unreadable directory is stepped over rather than thrown on', async () => {
	const locked = `${ROOT}\\16.0\\Locked`;
	const found = await findBackupFolder(probeOf({
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['Locked', 'Backup'],
		[`${ROOT}\\16.0\\Backup`]: ['Section.one'],
	}, new Set([locked])));

	assert.equal(found, `${ROOT}\\16.0\\Backup`);
});

test('files are not opened as directories while looking for sections', async () => {
	const opened: string[] = [];
	const tree = {
		[ROOT]: ['16.0'],
		[`${ROOT}\\16.0`]: ['cache', 'Backup'],
		[`${ROOT}\\16.0\\cache`]: ['cache0.onecache'],
		[`${ROOT}\\16.0\\Backup`]: ['Section.one'],
	};
	const probe = probeOf(tree);
	const list = probe.list;
	probe.list = async directory => {
		opened.push(directory);
		return await list(directory);
	};

	assert.equal(await findBackupFolder(probe), `${ROOT}\\16.0\\Backup`);
	assert.ok(!opened.includes(`${ROOT}\\16.0\\cache\\cache0.onecache`));
	assert.ok(!opened.includes(`${ROOT}\\16.0\\Backup\\Section.one`));
});
