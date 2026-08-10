import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { downloadAttachment } from '../../src/formats/notion-api/attachment-helpers';
import type { BlockConversionContext, NotionAttachment } from '../../src/formats/notion-api/types';
import { answerRequests } from '../shims/obsidian';
import { MemoryVault } from '../shims/vault';

interface Written {
	path: string;
	data: ArrayBuffer;
}

function context(written: Written[], overrides: Partial<BlockConversionContext> = {}): BlockConversionContext {
	return {
		ctx: {
			isCancelled: () => false,
			shouldStop: async () => false,
			status: () => {},
			reportSkipped: () => {},
			reportFailed: (name: string, reason?: unknown) => assert.fail(`${name}: ${reason}`),
		},
		currentFolderPath: '',
		currentPageTitle: 'A page with an inline image',
		client: {},
		vault: {
			createBinary: async (path: string, data: ArrayBuffer) => {
				written.push({ path, data });
			},
			getAbstractFileByPath: () => null,
		},
		app: {},
		downloadExternalAttachments: true,
		getAvailableAttachmentPath: async (filename: string) => `Attachments/${filename}`,
		...overrides,
	} as unknown as BlockConversionContext;
}

function bytesOf(buffer: ArrayBuffer): number[] {
	return Array.from(new Uint8Array(buffer));
}

// The shortest GIF that decodes, so the bytes can be written out in full.
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c];
const GIF_BASE64 = 'R0lGODlhAQABAAAAACw=';

test('a base64 data URL is decoded rather than requested', async () => {
	const written: Written[] = [];
	const attachment: NotionAttachment = {
		type: 'external',
		url: `data:image/gif;base64,${GIF_BASE64}`,
		name: 'inline-image',
	};

	const result = await downloadAttachment(attachment, context(written));

	assert.equal(result.isLocal, true);
	assert.equal(result.filename, 'inline-image.gif');
	assert.equal(written.length, 1);
	assert.equal(written[0].path, 'Attachments/inline-image.gif');
	assert.deepEqual(bytesOf(written[0].data), GIF);
});

test('the extension comes from the media type when the name has none', async () => {
	const written: Written[] = [];

	const result = await downloadAttachment(
		{ type: 'external', url: `data:image/gif;base64,${GIF_BASE64}` },
		context(written)
	);

	assert.equal(result.filename, 'A page with an inline image.gif');
	assert.equal(written[0].path, 'Attachments/A page with an inline image.gif');
});

test('a percent-encoded data URL is decoded too', async () => {
	const written: Written[] = [];

	await downloadAttachment(
		{ type: 'external', url: 'data:text/plain,a%20b%2Bc', name: 'note.txt' },
		context(written)
	);

	assert.equal(new TextDecoder().decode(written[0].data), 'a b+c');
});

test('a malformed data URL fails that attachment and leaves the URL in place', async () => {
	const written: Written[] = [];
	const failures: string[] = [];
	const url = 'data:image/gif;base64';

	const result = await downloadAttachment(
		{ type: 'external', url, name: 'broken' },
		context(written, {
			ctx: {
				isCancelled: () => false,
				shouldStop: async () => false,
				status: () => {},
				reportSkipped: () => {},
				reportFailed: (name: string) => failures.push(name),
			},
		} as unknown as Partial<BlockConversionContext>)
	);

	assert.deepEqual(failures, ['Attachment: broken']);
	assert.equal(written.length, 0);
	assert.deepEqual(result, { path: url, isLocal: false });
});

function contextOverVault(vault: MemoryVault, incrementalImport: boolean): BlockConversionContext {
	const skipped: string[] = [];

	return {
		ctx: {
			isCancelled: () => false,
			shouldStop: async () => false,
			status: () => {},
			reportSkipped: (name: string) => skipped.push(name),
			reportFailed: (name: string, reason?: unknown) => assert.fail(`${name}: ${String(reason)}`),
		},
		skipped,
		currentFolderPath: '',
		client: {},
		vault,
		app: {},
		downloadExternalAttachments: true,
		incrementalImport,
		getAvailableAttachmentPath: async (filename: string) => {
			const dot = filename.lastIndexOf('.');
			const base = dot > 0 ? filename.slice(0, dot) : filename;
			const extension = dot > 0 ? filename.slice(dot + 1) : undefined;

			return vault.getAvailablePath(`Attachments/${base}`, extension);
		},
	} as unknown as BlockConversionContext;
}

function attachmentOf(bytes: number): NotionAttachment {
	return {
		type: 'external',
		url: `data:text/plain,${'x'.repeat(bytes)}`,
		name: 'photo.txt',
	};
}

test('an attachment already imported is linked rather than copied', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	await vault.create('Attachments/photo.txt', 'xxxxx');

	const context = contextOverVault(vault, true);
	const result = await downloadAttachment(attachmentOf(5), context);

	assert.equal(result.path, 'Attachments/photo', 'the link should point at the copy already there');
	assert.deepEqual(vault.paths(), ['Attachments/photo.txt'], 'nothing should have been written');
	assert.deepEqual((context as never as { skipped: string[] }).skipped, ['Attachment: photo.txt']);
});

test('an attachment of the same name but a different size is a different file', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	await vault.create('Attachments/photo.txt', 'xxxxx');

	const result = await downloadAttachment(attachmentOf(9), contextOverVault(vault, true));

	assert.equal(result.path, 'Attachments/photo 1');
	assert.deepEqual(vault.paths().sort(), ['Attachments/photo 1.txt', 'Attachments/photo.txt']);
});

test('without incremental import the copy is written even when it matches', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	await vault.create('Attachments/photo.txt', 'xxxxx');

	const result = await downloadAttachment(attachmentOf(5), contextOverVault(vault, false));

	assert.equal(result.path, 'Attachments/photo 1');
	assert.deepEqual(vault.paths().sort(), ['Attachments/photo 1.txt', 'Attachments/photo.txt']);
});

test('a file that takes the chosen path is given another name', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	const createBinary = vault.createBinary.bind(vault);
	let firstWrite = true;

	vault.createBinary = async (path, data, options) => {
		if (firstWrite) {
			firstWrite = false;
			throw new Error('File already exists.');
		}

		return await createBinary(path, data, options);
	};

	const result = await downloadAttachment(attachmentOf(5), contextOverVault(vault, false));

	assert.equal(result.path, 'Attachments/photo 1');
	assert.deepEqual(vault.paths(), ['Attachments/photo 1.txt']);
});

test('a vault that refuses every name is not asked forever', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	let attempts = 0;

	vault.createBinary = async () => {
		attempts++;
		throw new Error('File already exists.');
	};

	const context = contextOverVault(vault, false);
	const failures: string[] = [];
	(context as unknown as { ctx: { reportFailed: unknown } }).ctx.reportFailed = (name: string) => failures.push(name);

	const result = await downloadAttachment(attachmentOf(5), context);

	assert.ok(attempts <= 21, `gave up after ${attempts} attempts`);
	assert.deepEqual(failures, ['Attachment: photo.txt']);
	assert.equal(result.isLocal, false, 'the attachment is reported rather than silently dropped');
});

function serving(bytes: number, options: { honoursRange?: boolean } = {}) {
	const { honoursRange = true } = options;
	const asked: string[] = [];
	const body = new TextEncoder().encode('x'.repeat(bytes)).buffer;

	answerRequests(request => {
		const ranged = Boolean(request.headers?.Range);
		asked.push(ranged ? 'range' : 'full');

		if (ranged && honoursRange) {
			const headers: Record<string, string> = {
				'content-range': `bytes 0-0/${bytes}`,
				'content-type': 'text/plain',
			};

			return { status: 206, headers, arrayBuffer: new TextEncoder().encode('x').buffer };
		}

		const headers: Record<string, string> = { 'content-type': 'text/plain' };

		return { status: 200, headers, arrayBuffer: body };
	});

	return { asked };
}

const REMOTE: NotionAttachment = { type: 'external', url: 'https://example.com/photo.txt', name: 'photo.txt' };

test('an attachment already in the vault is never fetched', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	await vault.create('Attachments/photo.txt', 'xxxxx');
	const server = serving(5);

	const result = await downloadAttachment(REMOTE, contextOverVault(vault, true));

	assert.equal(result.path, 'Attachments/photo');
	assert.deepEqual(server.asked, ['range'], 'the file itself should not have been fetched');
	assert.deepEqual(vault.paths(), ['Attachments/photo.txt']);
});

test('an attachment of a different size is fetched after the range says so', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	await vault.create('Attachments/photo.txt', 'xxxxx');
	const server = serving(9);

	const result = await downloadAttachment(REMOTE, contextOverVault(vault, true));

	assert.equal(result.path, 'Attachments/photo 1');
	assert.deepEqual(server.asked, ['range', 'full']);
});

test('a server that ignores the range is not asked a second time', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	const server = serving(5, { honoursRange: false });
	const context = contextOverVault(vault, true);

	await downloadAttachment(REMOTE, context);
	await downloadAttachment(REMOTE, context);

	assert.deepEqual(server.asked, ['range', 'full', 'full']);
});

test('without incremental import nothing is probed', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	const server = serving(5);

	await downloadAttachment(REMOTE, contextOverVault(vault, false));

	assert.deepEqual(server.asked, ['full']);
});

async function withoutWaiting<T>(body: () => Promise<T>): Promise<T> {
	const slept = window.setTimeout;
	(window as unknown as { setTimeout: unknown }).setTimeout = (wake: () => void) => (wake(), 0);

	try {
		return await body();
	}
	finally {
		(window as unknown as { setTimeout: unknown }).setTimeout = slept;
	}
}

function answersWith(...statuses: number[]) {
	const asked: number[] = [];

	answerRequests(() => {
		const status = statuses[asked.length] ?? 200;
		asked.push(status);

		return {
			status,
			headers: { 'content-type': 'text/plain' },
			arrayBuffer: new TextEncoder().encode('xxxxx').buffer,
		};
	});

	return { asked };
}

test('a status that means "not now" is asked about again', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	const server = answersWith(503, 500);

	const result = await withoutWaiting(() => downloadAttachment(REMOTE, contextOverVault(vault, false)));

	assert.deepEqual(server.asked, [503, 500, 200]);
	assert.equal(result.isLocal, true);
	assert.deepEqual(vault.paths(), ['Attachments/photo.txt']);
});

test('202 is worth another try from Notion, and not from anywhere else', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');

	const external = answersWith(202);
	await withoutWaiting(() => downloadAttachment(REMOTE, contextOverVault(vault, false)));
	assert.deepEqual(external.asked, [202], 'an external link should be asked once');

	const hosted = answersWith(202);
	await withoutWaiting(() => downloadAttachment({ ...REMOTE, type: 'file' }, contextOverVault(vault, false)));
	assert.deepEqual(hosted.asked, [202, 200], 'a Notion-hosted file should be asked again');
});

test('a status that will say the same thing next time is asked once', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	const server = answersWith(404);

	await withoutWaiting(() => downloadAttachment(REMOTE, contextOverVault(vault, false)));

	assert.deepEqual(server.asked, [404]);
});

test('an external link that will not download is kept rather than lost', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	answersWith(404);
	const context = contextOverVault(vault, false);

	const result = await withoutWaiting(() => downloadAttachment(REMOTE, context));

	assert.equal(result.isLocal, false);
	assert.equal(result.path, REMOTE.url);
	assert.deepEqual((context as never as { skipped: string[] }).skipped, ['Attachment: photo.txt']);
});

test('a file Notion was hosting failing to download is a failure', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Attachments');
	answersWith(403);
	const failures: string[] = [];
	const context = contextOverVault(vault, false);
	(context as unknown as { ctx: { reportFailed: unknown } }).ctx.reportFailed = (name: string) => failures.push(name);

	const hosted: NotionAttachment = { ...REMOTE, type: 'file' };
	const result = await withoutWaiting(() => downloadAttachment(hosted, context));

	assert.deepEqual(failures, ['Attachment: photo.txt']);
	assert.equal(result.isLocal, false);
});
