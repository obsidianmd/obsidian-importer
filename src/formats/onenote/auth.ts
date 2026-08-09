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
	// openid is what makes an id_token come back; the Graph access token is
	// opaque for personal accounts, so it is the only thing that says which
	// tenant signed in.
	personal: ['openid', 'user.read', 'notes.read'],
	// Work and school notebooks commonly live on SharePoint or in Teams, which
	// notes.read alone cannot reach — the 40004 behind issues #440 and #462.
	organization: ['openid', 'user.read', 'notes.read.all'],
} satisfies Record<MicrosoftAccountType, string[]>;

export function accountType(value: unknown): MicrosoftAccountType {
	return value === 'organization' ? value : 'personal';
}

/**
 * The tenant every personal Microsoft account signs in under. Anything else is
 * a work or school tenant.
 */
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

function decodeSegment(segment: string): unknown {
	// A JWT pads with base64url, which atob does not accept.
	const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
	return JSON.parse(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)));
}

/**
 * Which kind of account a token was issued to, or null if it does not say.
 *
 * Asking the user is the obvious alternative and it gets answered wrong in
 * both directions: a work account left on Personal is refused the notebooks it
 * came for, and a personal account set to Work or school is refused at consent
 * outright, because notes.read.all is not offered to personal accounts at all.
 * The token already carries the answer.
 */
export function accountTypeFromToken(token: string | undefined): MicrosoftAccountType | null {
	// Only an id_token is reliably readable here. The Graph access token is
	// opaque for personal accounts — a single segment, nothing to decode — so
	// reading that instead looks like it works and always answers null.
	const segments = token?.split('.') ?? [];
	const payload = segments.length === 3 ? segments[1] : undefined;
	if (!payload) return null;

	try {
		const claims = decodeSegment(payload);
		if (typeof claims !== 'object' || claims === null || !('tid' in claims)) return null;

		const tenant = (claims as { tid: unknown }).tid;
		if (typeof tenant !== 'string') return null;

		return tenant === CONSUMER_TENANT ? 'personal' : 'organization';
	}
	catch {
		// Microsoft does not promise this token is a readable JWT, and the
		// account type is only used to choose what to ask for next time.
		return null;
	}
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
