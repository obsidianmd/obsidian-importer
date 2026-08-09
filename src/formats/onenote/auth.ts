export type MicrosoftAccountType = 'personal' | 'organization';

const ACCOUNT = {
	personal: {
		tenant: 'consumers',
		scopes: ['user.read', 'notes.read'],
	},
	organization: {
		tenant: 'organizations',
		scopes: ['user.read', 'notes.read.all'],
	},
} satisfies Record<MicrosoftAccountType, { tenant: string, scopes: string[] }>;

export function accountType(value: unknown): MicrosoftAccountType {
	return value === 'organization' ? value : 'personal';
}

export function graphScopes(type: MicrosoftAccountType): string[] {
	return ACCOUNT[type].scopes;
}

export function tokenUrl(type: MicrosoftAccountType): string {
	return `https://login.microsoftonline.com/${ACCOUNT[type].tenant}/oauth2/v2.0/token`;
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
		prompt: 'select_account',
		state,
	});

	return `https://login.microsoftonline.com/${ACCOUNT[type].tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}
