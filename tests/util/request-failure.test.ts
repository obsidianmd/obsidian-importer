import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeRequestFailure, requestFailure } from '../../src/request-failure';

const ONENOTE = {
	name: 'OneNote',
	subject: 'your notebooks',
	credential: 'Try signing out and back in.',
};

test('a status, code and message are taken from the error itself', () => {
	const failure = requestFailure(Object.assign(new Error('Rate limited'), { status: 429, code: '20166' }));

	assert.deepEqual(failure, { status: 429, code: '20166', message: 'Rate limited' });
});

test('a Graph error body is read through its error property', () => {
	const failure = requestFailure({
		error: {
			code: '40004',
			message: 'The OAuth token provided does not have the necessary scopes',
		},
	});

	assert.equal(failure.code, '40004');
	assert.equal(failure.message, 'The OAuth token provided does not have the necessary scopes');
});

test('a nested message is preferred over the wrapper it arrived in', () => {
	const failure = requestFailure(Object.assign(new Error('Exceeded maximum retry attempts'), {
		status: 403,
		error: { code: '40004', message: 'The OAuth token provided does not have the necessary scopes' },
	}));

	assert.equal(failure.status, 403);
	assert.equal(failure.message, 'The OAuth token provided does not have the necessary scopes');
});

test('an error with nothing on it yields nothing rather than inventing a status', () => {
	assert.deepEqual(requestFailure(new Error('')), { status: undefined, code: undefined, message: undefined });
	assert.deepEqual(requestFailure(null), {});
	assert.deepEqual(requestFailure(undefined), {});
	assert.deepEqual(requestFailure('Failed to fetch'), { message: 'Failed to fetch' });
});

test('a status sent as a string is still a status', () => {
	assert.equal(requestFailure({ status: '503' }).status, 503);
	assert.equal(requestFailure({ status: '5' }).status, undefined);
});

test('a rejected credential is described as one, and says what to do', () => {
	const message = describeRequestFailure({ status: 401 }, ONENOTE);

	assert.equal(message, 'OneNote did not accept the request for your notebooks. Try signing out and back in.');
});

test('an account without access is not reported as throttling', () => {
	const message = describeRequestFailure({ status: 403, error: { code: '40004' } }, ONENOTE);

	assert.match(message, /would not give access/);
	assert.doesNotMatch(message, /limiting how fast/);
});

test('throttling is described as throttling', () => {
	const message = describeRequestFailure({ status: 429 }, ONENOTE);

	assert.equal(message, 'OneNote is limiting how fast your notebooks can be read. Wait a few minutes and try again.');
});

test('a timeout and an outage read differently', () => {
	assert.match(describeRequestFailure({ status: 504 }, ONENOTE), /took too long/);
	assert.match(describeRequestFailure({ status: 500 }, ONENOTE), /could not return your notebooks right now/);
});

test('an unrecognised failure shows what the service said', () => {
	const message = describeRequestFailure(new Error('Failed to fetch'), ONENOTE);

	assert.equal(message, 'Could not read your notebooks: Failed to fetch');
});

test('a code travels with the message it explains', () => {
	const message = describeRequestFailure({ code: 'restricted_resource', message: 'Insufficient permissions' }, {
		name: 'Notion',
		subject: 'your pages',
		credential: 'Check your token.',
	});

	assert.equal(message, 'Could not read your pages: Insufficient permissions (restricted_resource)');
});

test('an error carrying nothing at all still names what failed', () => {
	assert.equal(describeRequestFailure({}, ONENOTE), 'Could not read your notebooks.');
});
