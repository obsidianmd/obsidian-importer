export interface AccessTokenResponse {
	token_type: string;
	scope: string;
	expires_in: number;
	access_token: string;
	id_token?: string;
	refresh_token?: string;
}