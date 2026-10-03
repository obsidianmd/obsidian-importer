import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';

import { MAX_PREVIEW_IMAGE_BYTES, PREVIEW_IMAGE_PLACEHOLDER, PreviewImageStore } from '../../src/preview-image';

test('shares a pending image read and releases its Blob URL exactly once', async (t) => {
	const images = new PreviewImageStore();
	t.after(() => images.dispose());
	let finish!: (data: ArrayBuffer) => void;
	let reads = 0;
	const read = () => {
		reads++;
		return new Promise<ArrayBuffer>(resolve => finish = resolve);
	};
	const first = images.get('photo', 'image/png', read);
	const second = images.get('photo', 'image/png', read);
	assert.equal(reads, 1);
	finish(new Uint8Array([1, 2, 3]).buffer);
	const url = await first;
	assert.equal(await second, url);
	assert.equal(await images.get('photo', 'image/png', read), url);
	assert.equal(reads, 1);
	assert.ok(resolveObjectURL(url));
	const revoke = t.mock.method(URL, 'revokeObjectURL');
	images.dispose();
	images.dispose();
	assert.equal(resolveObjectURL(url), undefined);
	assert.equal(revoke.mock.callCount(), 1);
	assert.equal(await images.get('photo', 'image/png', read), PREVIEW_IMAGE_PLACEHOLDER);
	assert.equal(reads, 1);
});

test('a cancelled preview never allocates a URL for an image still loading', async (t) => {
	const images = new PreviewImageStore();
	let finish!: (data: ArrayBuffer) => void;
	const create = t.mock.method(URL, 'createObjectURL');
	const loading = images.get('photo', 'image/png', () => new Promise(resolve => finish = resolve));
	images.dispose();
	finish(new ArrayBuffer(10));
	assert.equal(await loading, PREVIEW_IMAGE_PLACEHOLDER);
	assert.equal(create.mock.callCount(), 0);
});

test('caps individual images and total preview bytes while reusing existing images', async (t) => {
	const images = new PreviewImageStore();
	t.after(() => images.dispose());
	let reads = 0;
	const read = async () => {
		reads++;
		return new ArrayBuffer(MAX_PREVIEW_IMAGE_BYTES);
	};
	assert.equal(await images.get('oversized', 'image/png', read, MAX_PREVIEW_IMAGE_BYTES + 1), PREVIEW_IMAGE_PLACEHOLDER);
	assert.equal(reads, 0);
	assert.equal(await images.get('actual-oversized', 'image/png', async () => new ArrayBuffer(MAX_PREVIEW_IMAGE_BYTES + 1)), PREVIEW_IMAGE_PLACEHOLDER);
	const first = await images.get('first', 'image/png', read);
	const second = await images.get('second', 'image/png', read);
	assert.ok(resolveObjectURL(first));
	assert.ok(resolveObjectURL(second));
	assert.equal(await images.get('first', 'image/png', read), first);
	assert.equal(await images.get('third', 'image/png', read, MAX_PREVIEW_IMAGE_BYTES), PREVIEW_IMAGE_PLACEHOLDER);
	assert.equal(reads, 2);
	assert.equal(await images.get('unknown-size', 'image/png', read), PREVIEW_IMAGE_PLACEHOLDER);
});

test('an unreadable image leaves room for other previews', async (t) => {
	const images = new PreviewImageStore();
	t.after(() => images.dispose());
	assert.equal(await images.get('broken', 'image/png', async () => { throw new Error('read failed'); }), PREVIEW_IMAGE_PLACEHOLDER);
	const url = await images.get('ok', 'image/png', async () => new ArrayBuffer(10));
	assert.ok(resolveObjectURL(url));
});
