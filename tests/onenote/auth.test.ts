import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountType, authorizationUrl, graphScopes, tokenUrl } from '../../src/formats/onenote/auth';

const CLIENT_ID = 'client-id';
const REDIRECT_URI = 'obsidian://importer-auth/';

test('personal accounts ask only for their own notebooks', () => {
	const url = new URL(authorizationUrl('personal', CLIENT_ID, REDIRECT_URI, 'state'));

	assert.equal(url.hostname, 'login.microsoftonline.com');
	assert.deepEqual(graphScopes('personal'), ['user.read', 'notes.read']);
	assert.equal(url.searchParams.get('scope'), 'offline_access user.read notes.read');
});

test('work and school accounts request organization notebook access', () => {
	const url = new URL(authorizationUrl('organization', CLIENT_ID, REDIRECT_URI, 'state'));

	assert.deepEqual(graphScopes('organization'), ['user.read', 'notes.read.all']);
	assert.equal(url.searchParams.get('scope'), 'offline_access user.read notes.read.all');
});

test('both account kinds sign in through the common authority', () => {
	// A tenant-specific authority rejects a refresh token issued by common, so
	// choosing one per account type signs out everyone who upgrades — and then
	// refuses the work accounts it sent to the consumer endpoint.
	for (const type of ['personal', 'organization'] as const) {
		const url = new URL(authorizationUrl(type, CLIENT_ID, REDIRECT_URI, 'state'));
		assert.equal(url.pathname, '/common/oauth2/v2.0/authorize', `for ${type}`);
	}

	assert.equal(tokenUrl(), 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
});

test('sign-in always asks which remembered account to use', () => {
	for (const type of ['personal', 'organization'] as const) {
		const url = new URL(authorizationUrl(type, CLIENT_ID, REDIRECT_URI, 'state'));
		assert.equal(url.searchParams.get('prompt'), 'select_account');
		assert.equal(url.searchParams.get('state'), 'state');
	}
});

test('an unknown stored account type falls back to personal', () => {
	assert.equal(accountType(undefined), 'personal');
	assert.equal(accountType('work'), 'personal');
	assert.equal(accountType('organization'), 'organization');
});
