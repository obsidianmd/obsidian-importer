import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountType, authorizationUrl, graphScopes, tokenUrl } from '../../src/formats/onenote/auth';

const CLIENT_ID = 'client-id';
const REDIRECT_URI = 'obsidian://importer-auth/';

test('personal accounts use the consumer authority and personal OneNote scope', () => {
	const url = new URL(authorizationUrl('personal', CLIENT_ID, REDIRECT_URI, 'state'));

	assert.equal(url.hostname, 'login.microsoftonline.com');
	assert.equal(url.pathname, '/consumers/oauth2/v2.0/authorize');
	assert.equal(url.searchParams.get('scope'), 'offline_access user.read notes.read');
	assert.equal(tokenUrl('personal'), 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
});

test('work and school accounts request organization notebook access', () => {
	const url = new URL(authorizationUrl('organization', CLIENT_ID, REDIRECT_URI, 'state'));

	assert.equal(url.pathname, '/organizations/oauth2/v2.0/authorize');
	assert.deepEqual(graphScopes('organization'), ['user.read', 'notes.read.all']);
	assert.equal(url.searchParams.get('scope'), 'offline_access user.read notes.read.all');
	assert.equal(tokenUrl('organization'), 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
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
