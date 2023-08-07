export interface DeviceCode {
    device_code: string;
    user_code: string;
    verification_uri: URL;
    expires_in: number;
    interval: number;
    message: string;
}
export interface TokenResponse {
    token_type: string;
    scope: string;
    expires_in: number;
    access_token: string;
    id_token?: string;
    refresh_token?: string;
}