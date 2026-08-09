import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeNotebookFailure } from '../../src/formats/onenote/errors';

test('the scope failure names the account type that causes it', () => {
	const message = describeNotebookFailure({
		error: {
			code: '40004',
			message: 'The OAuth token provided does not have the necessary scopes',
		},
	});

	assert.match(message, /choose Work or school/);
	assert.doesNotMatch(message, /limiting how fast/);
});

test('the scope failure is recognised however it is wrapped', () => {
	const message = describeNotebookFailure(Object.assign(new Error('Exceeded maximum retry attempts'), {
		status: 403,
		error: { code: '40004' },
	}));

	assert.match(message, /work or school account/);
});

test('throttling is still reported as throttling', () => {
	for (const error of [{ status: 429 }, { error: { code: '20166' } }]) {
		assert.match(describeNotebookFailure(error), /limiting how fast/, `for ${JSON.stringify(error)}`);
	}
});

test('a rejected sign-in says to sign in again', () => {
	const message = describeNotebookFailure({ status: 401 });

	assert.match(message, /Sign out and back in/);
	assert.doesNotMatch(message, /limiting how fast/);
});

test('an outage is not blamed on the account', () => {
	assert.match(describeNotebookFailure({ status: 503 }), /could not return your notebooks right now/);
	assert.match(describeNotebookFailure({ status: 504 }), /took too long/);
});

test('an unrecognised failure repeats what OneNote said rather than guessing', () => {
	const message = describeNotebookFailure(new Error('Failed to fetch'));

	assert.equal(message, 'Could not read your notebooks: Failed to fetch');
});
