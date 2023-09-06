export interface ErrorResponse {
    error: string;
    error_description: string;
    error_codes: number[];
    timestamp: string;
    trace_id: string;
    correlation_id: string;
}

export interface AccessTokenResponse {
    token_type: string;
    scope: string;
    expires_in: number;
    access_token: string;
    id_token?: string;
    refresh_token?: string;
}