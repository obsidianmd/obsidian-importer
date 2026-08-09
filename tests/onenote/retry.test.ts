/**
 * How fetchResource decides between asking again and giving up.
 *
 * All of this was verified by hand against a stubbed Graph, which is how the
 * bugs in it were found and also why they were found late. What each case
 * asserts is the request count as much as the message: the point of failing
 * fast on a refusal is that it does not spend five round trips first, and the
 * point of keeping the retry for a bare 400 is that it does.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OneNoteImporter } from '../../src/formats/onenote';
import { ImportContext } from '../../src/import-context';

const URL = 'https://graph.microsoft.com/v1.0/me/onenote/notebooks';

interface Answer {
	status: number;
	body?: unknown;
	raw?: string;
}

/**
 * Drives fetchResource against a stubbed Graph. Returns how many requests were
 * made and what came back out, so a test can assert on both.
 */
async function fetching(
	answers: Answer | Answer[],
	progress?: ImportContext,
	allowBackOff = false,
): Promise<{ backOffs: number, calls: number, error: unknown, refreshes: number }> {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	const sequence = Array.isArray(answers) ? answers : [answers];
	let backOffs = 0;
	let calls = 0;
	let refreshes = 0;

	Object.assign(subject, {
		graphData: { accessToken: 'token' },
		host: { abortController: new AbortController() },
		lastSuccessfulFetchTime: performance.now(),
		updateAccessToken: async () => { refreshes++; },
		backOff: async () => {
			backOffs++;
			if (!allowBackOff) throw new Error('backed off during a test');
		},
	});

	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		const answer = sequence[Math.min(calls, sequence.length - 1)];
		calls++;
		const body = answer.raw ?? JSON.stringify(answer.body ?? {});
		return new Response(body, {
			status: answer.status,
			headers: { 'Content-Type': answer.raw === undefined ? 'application/json' : 'text/html' },
		});
	}) as typeof fetch;

	let error: unknown = null;
	try {
		await subject.fetchResource(URL, 'json', progress);
	}
	catch (e) {
		error = e;
	}
	finally {
		globalThis.fetch = realFetch;
	}

	return { backOffs, calls, error, refreshes };
}

const graph = (code: string, message = '') => ({ error: { code, message } });

test('a refusal is not asked again', async () => {
	// 403 and 404 are decisions. Retrying them spends the time and then
	// replaces what Graph said with 'Exceeded maximum retry attempts'.
	for (const status of [403, 404]) {
		const { calls } = await fetching({ status, body: graph('40004') });
		assert.equal(calls, 1, `for ${status}`);
	}
});

test('40004 refuses whatever status carries it', async () => {
	// The scope failure behind #440 has been reported with more than one.
	const { calls, error } = await fetching({ status: 400, body: graph('40004', 'no scopes') });

	assert.equal(calls, 1);
	assert.equal((error as { code?: string }).code, '40004');
});

test('a bare 400 is still retried', async () => {
	// OneNote answers page requests with these, and they usually clear.
	// Narrowing retries to 408/429/5xx had quietly dropped this.
	const { calls } = await fetching({ status: 400, body: graph('19999') });

	assert.equal(calls, 5);
});

test('an outage is retried, and reports the outage rather than the retrying', async () => {
	const { calls, error } = await fetching({ status: 503, body: graph('UnknownError') });

	assert.equal(calls, 5);
	assert.equal((error as { status?: number }).status, 503);
});

test('a 401 refreshes once and then refuses', async () => {
	// Refreshing is the whole remedy, so a 401 that survives it is the account
	// not being allowed to read this — worth saying instead of retrying into
	// 'Exceeded maximum retry attempts'.
	const { calls, error, refreshes } = await fetching({ status: 401, body: graph('InvalidAuthenticationToken') });

	assert.equal(refreshes, 1);
	assert.equal(calls, 2);
	assert.equal((error as { status?: number }).status, 401);
});

test('throttling refuses at once when there is no import to pace', async () => {
	// The picker has nothing on screen that waiting helps, so it would sit
	// silently for a minute an attempt — issue #390. backOff throws in this
	// harness, so reaching it at all would fail the test.
	for (const answer of [{ status: 429, body: graph('20166') }, { status: 503, body: graph('20166') }]) {
		const { calls, error } = await fetching(answer);
		assert.equal(calls, 1, `for ${answer.status}`);
		assert.equal((error as { status?: number }).status, 429, `for ${answer.status}`);
	}
});

test('throttling waits and retries during an import', async () => {
	const progress = new ImportContext();
	const { backOffs, calls, error } = await fetching([
		{ status: 429, body: graph('20166') },
		{ status: 200, body: { value: [] } },
	], progress, true);

	assert.equal(backOffs, 1);
	assert.equal(calls, 2);
	assert.equal(error, null);
});

test('a non-JSON error body still reaches the branch that describes it', async () => {
	// An empty body, or an HTML page from a proxy, used to reject out of
	// response.json() and be retried as though the network had failed.
	const { calls, error } = await fetching({ status: 429, raw: '<html>Too Many Requests</html>' });

	assert.equal(calls, 1);
	assert.equal((error as { status?: number }).status, 429);
});

test('an empty body on an outage is retried, not mistaken for something else', async () => {
	const { calls, error } = await fetching({ status: 503, raw: '' });

	assert.equal(calls, 5);
	assert.equal((error as { status?: number }).status, 503);
});
