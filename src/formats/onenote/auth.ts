export type MicrosoftAccountType = 'personal' | 'organization';

// Keep the common authority so existing refresh tokens remain valid.
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';

// openid returns the ID token used to identify the account type.
const SCOPES = {
	personal: ['openid', 'user.read', 'notes.read'],
	organization: ['openid', 'user.read', 'notes.read.all'],
} satisfies Record<MicrosoftAccountType, string[]>;

/** What was stored for the account, or null when nothing recognisable was. */
export function storedAccountType(value: unknown): MicrosoftAccountType | null {
	return value === 'organization' || value === 'personal' ? value : null;
}

const MICROSOFT_CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

function decodeSegment(segment: string): unknown {
	const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
	return JSON.parse(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)));
}

export function accountTypeFromToken(token: string | undefined): MicrosoftAccountType | null {
	const segments = token?.split('.') ?? [];
	const payload = segments.length === 3 ? segments[1] : undefined;
	if (!payload) return null;

	try {
		const claims = decodeSegment(payload);
		if (typeof claims !== 'object' || claims === null || !('tid' in claims)) return null;

		const tenant = (claims as { tid: unknown }).tid;
		if (typeof tenant !== 'string') return null;

		return tenant === MICROSOFT_CONSUMER_TENANT_ID ? 'personal' : 'organization';
	}
	catch {
		return null;
	}
}

export function graphScopes(type: MicrosoftAccountType): string[] {
	return SCOPES[type];
}

export const TOKEN_URL = `${AUTHORITY}/token`;

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
		prompt: 'select_account',
		state,
	});

	return `${AUTHORITY}/authorize?${params.toString()}`;
}
