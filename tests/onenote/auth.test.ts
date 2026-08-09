import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountType, accountTypeFromToken, authorizationUrl, graphScopes, tokenUrl } from '../../src/formats/onenote/auth';

const CLIENT_ID = 'client-id';
const REDIRECT_URI = 'obsidian://importer-auth/';

test('personal accounts ask only for their own notebooks', () => {
	const url = new URL(authorizationUrl('personal', CLIENT_ID, REDIRECT_URI, 'state'));

	assert.equal(url.hostname, 'login.microsoftonline.com');
	assert.deepEqual(graphScopes('personal'), ['openid', 'user.read', 'notes.read']);
	assert.equal(url.searchParams.get('scope'), 'offline_access openid user.read notes.read');
});

test('work and school accounts request organization notebook access', () => {
	const url = new URL(authorizationUrl('organization', CLIENT_ID, REDIRECT_URI, 'state'));

	assert.deepEqual(graphScopes('organization'), ['openid', 'user.read', 'notes.read.all']);
	assert.equal(url.searchParams.get('scope'), 'offline_access openid user.read notes.read.all');
});

test('both kinds ask for openid, which is what returns a readable token', () => {
	// The Graph access token is opaque for a personal account, so the id_token
	// is the only thing that says which tenant signed in.
	for (const type of ['personal', 'organization'] as const) {
		assert.ok(graphScopes(type).includes('openid'), `for ${type}`);
	}
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

/** A JWT with the given claims, signature omitted the way we never check it. */
function token(claims: Record<string, unknown>): string {
	const encode = (value: object) => Buffer.from(JSON.stringify(value))
		.toString('base64')
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

	return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

test('the tenant in the token says which kind of account signed in', () => {
	// Every personal Microsoft account signs in under this one tenant.
	assert.equal(accountTypeFromToken(token({ tid: '9188040d-6c67-4c5b-b112-36a304b66dad' })), 'personal');
	assert.equal(accountTypeFromToken(token({ tid: '72f988bf-86f1-41af-91ab-2d7cd011db47' })), 'organization');
});

test('a token that does not say leaves the choice alone', () => {
	// Nothing promises a readable token, and the answer only decides what to
	// ask for next time, so not knowing is a valid state.
	for (const value of [undefined, '', 'not-a-jwt', 'a.b', token({}), `${token({})}`.replace(/\..*/, '.!!!.x')]) {
		assert.equal(accountTypeFromToken(value), null, `for ${JSON.stringify(value)}`);
	}
});

test('an opaque access token is not mistaken for a readable one', () => {
	// What Microsoft actually returns for a personal account: one segment,
	// nothing to decode. Splitting on '.' and taking [1] gives undefined here,
	// but a two-segment string would have handed back a base64 blob to parse.
	assert.equal(accountTypeFromToken('EwAoA8l6BAAUAOyDv0l6PcCVu89kmzvqZmkWABkAAY'), null);
	assert.equal(accountTypeFromToken('opaque.token'), null);
});

test('a tenant claim of the wrong shape is not read as an organization', () => {
	assert.equal(accountTypeFromToken(token({ tid: 42 })), null);
	assert.equal(accountTypeFromToken(token({ tid: null })), null);
});
