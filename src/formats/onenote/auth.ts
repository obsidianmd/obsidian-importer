export type MicrosoftAccountType = 'personal' | 'organization';

/**
 * Both account kinds sign in through the same authority.
 *
 * Pinning each kind to its own tenant (`consumers` / `organizations`) looks
 * tidier and breaks every existing sign-in: a refresh token issued by `common`
 * is rejected by either of them, and since the stored account type defaults to
 * personal, a work account would be signed out on upgrade and then refused at
 * the consumer endpoint it was sent to. `common` accepts both, so what the
 * account type selects is the access being asked for, not where to ask.
 */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';

const SCOPES = {
	// A personal account holds its own notebooks and nothing else, so the
	// narrower scope covers it and keeps the consent screen honest.
	personal: ['user.read', 'notes.read'],
	// Work and school notebooks commonly live on SharePoint or in Teams, which
	// notes.read alone cannot reach — the 40004 behind issues #440 and #462.
	organization: ['user.read', 'notes.read.all'],
} satisfies Record<MicrosoftAccountType, string[]>;

export function accountType(value: unknown): MicrosoftAccountType {
	return value === 'organization' ? value : 'personal';
}

export function graphScopes(type: MicrosoftAccountType): string[] {
	return SCOPES[type];
}

export function tokenUrl(): string {
	return `${AUTHORITY}/token`;
}

export function authorizationUrl(
	type: MicrosoftAccountType,
	clientId: string,
	redirectUri: string,
	state: string,
): string {
	const params = new URLSearchParams({
		client_id: clientId,
		scope: `offline_access ${graphScopes(type).join(' ')}`,
		response_type: 'code',
		redirect_uri: redirectUri,
		response_mode: 'query',
		// Without this, Microsoft silently reuses whichever account the browser
		// is already signed in to, which is issue #278.
		prompt: 'select_account',
		state,
	});

	return `${AUTHORITY}/authorize?${params.toString()}`;
}
