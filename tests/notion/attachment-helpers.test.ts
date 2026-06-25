import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

import type { BlockConversionContext, NotionAttachment } from '../../src/formats/notion-api/types';

const originalLoad = Module._load;
Module._load = function(request: string, ...args: unknown[]) {
	if (request === 'obsidian') {
		return {
			normalizePath: (path: string) => path.replace(/\/+/g, '/'),
			requestUrl: async () => {
				throw new Error('requestUrl should not be used for data URL attachments');
			},
			Platform: {
				isDesktopApp: false,
			},
			TFile: class TFile {},
		};
	}

	return originalLoad.apply(this, [request, ...args]);
};

async function loadDownloadAttachment() {
	return (await import('../../src/formats/notion-api/attachment-helpers')).downloadAttachment;
}

interface BinaryWrite {
	path: string;
	data: ArrayBuffer;
	options: Record<string, unknown>;
}

function makeContext(writes: BinaryWrite[], currentPageTitle = 'Imported page'): BlockConversionContext {
	return {
		ctx: {
			status: () => {},
			reportFailed: () => {},
			reportSkipped: () => {},
		},
		currentFolderPath: '',
		currentPageTitle,
		client: {},
		vault: {
			createBinary: async (path: string, data: ArrayBuffer, options: Record<string, unknown>) => {
				writes.push({ path, data, options });
			},
			getAbstractFileByPath: () => null,
		},
		app: {},
		downloadExternalAttachments: true,
		getAvailableAttachmentPath: async (filename: string) => `Assets/${filename}`,
	} as unknown as BlockConversionContext;
}

function toBase64(arrayBuffer: ArrayBuffer): string {
	return Buffer.from(new Uint8Array(arrayBuffer)).toString('base64');
}

test('downloads base64 data URL attachments without requestUrl', async () => {
	const downloadAttachment = await loadDownloadAttachment();
	const writes: BinaryWrite[] = [];
	const base64 = 'R0lGODlhAQABAAAAACw=';
	const attachment: NotionAttachment = {
		type: 'external',
		url: `data:image/gif;base64,${base64}`,
		name: 'inline-image',
		created_time: '2024-01-01T00:00:00.000Z',
		last_edited_time: '2024-01-02T00:00:00.000Z',
	};

	const result = await downloadAttachment(attachment, makeContext(writes));

	assert.deepEqual(result, {
		path: 'Assets/inline-image',
		isLocal: true,
		filename: 'inline-image.gif',
	});
	assert.equal(writes.length, 1);
	assert.equal(writes[0].path, 'Assets/inline-image.gif');
	assert.equal(toBase64(writes[0].data), base64);
	assert.equal(writes[0].options.ctime, new Date('2024-01-01T00:00:00.000Z').getTime());
	assert.equal(writes[0].options.mtime, new Date('2024-01-02T00:00:00.000Z').getTime());
});

test('uses page title fallback for unnamed data URL attachments', async () => {
	const downloadAttachment = await loadDownloadAttachment();
	const writes: BinaryWrite[] = [];
	const attachment: NotionAttachment = {
		type: 'external',
		url: 'data:text/plain,hello%20world',
	};

	const result = await downloadAttachment(attachment, makeContext(writes, 'Clipped web page'));

	assert.deepEqual(result, {
		path: 'Assets/Clipped web page',
		isLocal: true,
		filename: 'Clipped web page.txt',
	});
	assert.equal(writes[0].path, 'Assets/Clipped web page.txt');
	assert.equal(Buffer.from(new Uint8Array(writes[0].data)).toString('utf8'), 'hello world');
	assert.doesNotMatch(writes[0].path, /base64|data:/);
});
