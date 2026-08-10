import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeNotionRequest } from '../../src/formats/notion-api/api-helpers';
import { ImportContext } from '../../src/import-context';
import { withoutWaiting } from '../helpers';

function failingWith(...failures: Record<string, unknown>[]) {
	let calls = 0;

	return {
		get calls() { return calls; },
		request: async () => {
			const failure = failures[calls++];
			if (!failure) return 'the answer';
			throw Object.assign(new Error(String(failure.message ?? 'failed')), failure);
		},
	};
}

test('a gateway error is asked about again', async () => {
	const notion = failingWith({ status: 502, message: 'Request to Notion API failed with status: 502' });

	const answer = await withoutWaiting(() => makeNotionRequest(notion.request, new ImportContext()));

	assert.equal(answer, 'the answer');
	assert.equal(notion.calls, 2);
});

test('so is a rate limit, a timeout, and a response the client could not read', async () => {
	for (const failure of [
		{ code: 'rate_limited', status: 429 },
		{ code: 'service_unavailable', status: 503 },
		{ code: 'gateway_timeout', status: 504 },
		{ code: 'notionhq_client_request_timeout' },
		{ code: 'notionhq_client_response_error' },
		{ status: 408 },
	]) {
		const notion = failingWith(failure);

		await withoutWaiting(() => makeNotionRequest(notion.request, new ImportContext()));

		assert.equal(notion.calls, 2, `${JSON.stringify(failure)} should have been retried`);
	}
});

test('a failure that asks to be retried is retried', async () => {
	const notion = failingWith({
		status: 400,
		message: 'Public API object rendering exceeded the response time budget. Retry with exponential backoff; if the issue persists, reduce the size of the request.',
	});

	await withoutWaiting(() => makeNotionRequest(notion.request, new ImportContext()));

	assert.equal(notion.calls, 2);
});

test('a failure that will say the same thing next time is asked once', async () => {
	for (const failure of [
		{ code: 'object_not_found', status: 404 },
		{ code: 'unauthorized', status: 401 },
		{ code: 'restricted_resource', status: 403 },
		{ code: 'validation_error', status: 400 },
	]) {
		const notion = failingWith(failure, failure, failure, failure, failure);

		await assert.rejects(() => withoutWaiting(() => makeNotionRequest(notion.request, new ImportContext())));
		assert.equal(notion.calls, 1, `${JSON.stringify(failure)} should not have been retried`);
	}
});

test('a Retry-After is waited for rather than guessed at', async () => {
	const notion = failingWith({ status: 429, code: 'rate_limited', headers: { 'retry-after': '7' } });
	const waits: number[] = [];

	await withoutWaiting(() => makeNotionRequest(notion.request, new ImportContext()), waits);

	assert.deepEqual(waits, [7000]);
});

test('giving up says what kept failing', async () => {
	const notion = failingWith(...Array(5).fill({ status: 502, message: 'Request to Notion API failed with status: 502' }));

	await assert.rejects(
		() => withoutWaiting(() => makeNotionRequest(notion.request, new ImportContext())),
		/status: 502, and gave up after 3 retries/
	);

	assert.equal(notion.calls, 4, 'the first try and three retries');
});

test('a cancelled import stops rather than backing off again', async () => {
	const ctx = new ImportContext();
	const notion = failingWith(...Array(5).fill({ status: 503 }));
	ctx.cancel();

	await assert.rejects(() => withoutWaiting(() => makeNotionRequest(notion.request, ctx)));
	assert.equal(notion.calls, 1);
});
