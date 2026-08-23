import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from 'obsidian';

import {
	AndroidFilesystem,
	AndroidFolderPickerError,
	AndroidPickedFile,
	AndroidPickedFolder,
	chooseAndroidFolder,
	hasAndroidFolderPicker,
} from '../../src/filesystem';

function base64(text: string): string {
	return Buffer.from(text).toString('base64');
}

test('an Android folder lists files and nested folders through the native bridge', async () => {
	const filesystem: AndroidFilesystem = {
		choose: async () => ({ path: '', uri: '', isRoot: false }),
		checkPerms: async () => {},
		requestPerms: async () => {},
		readdir: async ({ path }) => ({
			files: path.endsWith('/Notes')
				? [
					{ name: 'Index.MD', type: 'file', size: 7, ctime: 1_000, mtime: 2_000 },
					{ name: 'Journal', type: 'directory' },
				]
				: [{ name: 'Day.md', type: 'file' }],
		}),
		readFile: async ({ path }) => ({ data: base64(path.endsWith('Index.MD') ? '# Index' : '# Day') }),
	};

	const folder = new AndroidPickedFolder('/storage/emulated/0/Documents/Notes/', filesystem);
	assert.equal(folder.name, 'Notes');
	assert.equal(folder.toString(), '/storage/emulated/0/Documents/Notes');

	const [index, journal] = await folder.list();
	assert.ok(index instanceof AndroidPickedFile);
	assert.equal(index.extension, 'md');
	assert.equal(index.fullpath, 'Notes/Index.MD');
	assert.equal(index.size, 7);
	assert.equal(index.ctime, 1_000);
	assert.equal(index.mtime, 2_000);
	assert.equal(await index.readText(), '# Index');

	assert.ok(journal instanceof AndroidPickedFolder);
	const [day] = await journal.list();
	assert.ok(day instanceof AndroidPickedFile);
	assert.equal(day.fullpath, 'Notes/Journal/Day.md');
	assert.equal(await day.readText(), '# Day');
});

test('the Android folder button is gated by both platform and native bridge availability', () => {
	const platform = Platform as typeof Platform & { isAndroidApp?: boolean };
	const original = platform.isAndroidApp;
	const filesystem = {} as AndroidFilesystem;

	try {
		platform.isAndroidApp = false;
		assert.equal(hasAndroidFolderPicker(filesystem), false);

		platform.isAndroidApp = true;
		assert.equal(hasAndroidFolderPicker(null), false);
		assert.equal(hasAndroidFolderPicker(filesystem), true);
	}
	finally {
		platform.isAndroidApp = original;
	}
});

test('the Android picker requests storage permission before choosing when needed', async () => {
	const calls: string[] = [];
	const filesystem: AndroidFilesystem = {
		checkPerms: async () => {
			calls.push('check');
			throw new Error('No Permission');
		},
		requestPerms: async () => {
			calls.push('request');
		},
		choose: async () => {
			calls.push('choose');
			return {
				path: '/storage/emulated/0/Documents/Notes',
				uri: 'content://documents/tree/Notes',
				isRoot: false,
			};
		},
		readdir: async () => ({ files: [] }),
		readFile: async () => ({ data: '' }),
	};

	const folder = await chooseAndroidFolder(filesystem);
	assert.equal(folder?.name, 'Notes');
	assert.deepEqual(calls, ['check', 'request', 'choose']);
});

test('canceling the Android folder picker selects nothing', async () => {
	const filesystem: AndroidFilesystem = {
		checkPerms: async () => {},
		requestPerms: async () => {},
		choose: async () => {
			throw new Error('canceled');
		},
		readdir: async () => ({ files: [] }),
		readFile: async () => ({ data: '' }),
	};

	assert.equal(await chooseAndroidFolder(filesystem), null);
});

test('a British-spelled cancellation also selects nothing', async () => {
	const filesystem: AndroidFilesystem = {
		checkPerms: async () => {},
		requestPerms: async () => {},
		choose: async () => {
			throw new Error('cancelled');
		},
		readdir: async () => ({ files: [] }),
		readFile: async () => ({ data: '' }),
	};

	assert.equal(await chooseAndroidFolder(filesystem), null);
});

test('the Android picker rejects the device root', async () => {
	const filesystem: AndroidFilesystem = {
		checkPerms: async () => {},
		requestPerms: async () => {},
		choose: async () => ({ path: '/storage/emulated/0', uri: 'content://documents/root', isRoot: true }),
		readdir: async () => ({ files: [] }),
		readFile: async () => ({ data: '' }),
	};

	await assert.rejects(chooseAndroidFolder(filesystem), (error: unknown) =>
		error instanceof AndroidFolderPickerError && error.reason === 'root');
});
