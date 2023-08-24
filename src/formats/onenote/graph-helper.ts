import { ObsidianProtocolData, requestUrl } from 'obsidian';
import { tokenResponse } from './models/tokenResponse';

const GRAPH_CLIENT_ID: string = 'c1a20926-78a8-47c8-a2a4-650e482bd8d2'; // TODO: replace with an Obsidian team owned client_Id
const GRAPH_SCOPES: string[] = ['user.read', 'notes.read'];
const REDIRECT_URI: string = 'obsidian://importer-onenote-signin/';

export class MicrosoftGraphHelper {
	accessToken: string = '';
	state: string = this.generateRandomState(32);

	// Generate state for OAuth authentication
	generateRandomState(length: number): string {
		const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let state = '';
		
		// Secure enough to prevent basic CSRF :)
		for (let i = 0; i < length; i++) {
		  const randomIndex = Math.floor(Math.random() * charset.length);
		  state += charset.charAt(randomIndex);
		}
		
		return state;
	}
	  
	openOAuthPage() {
		const requestBody = new URLSearchParams({
			client_id: GRAPH_CLIENT_ID,
			scope: GRAPH_SCOPES.join(' '),
			response_type: 'code',
			redirect_uri: REDIRECT_URI,
			response_mode: 'query',
			state: this.state,
		});

		window.open(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${requestBody.toString()}`);
	}

	async requestAccessToken(protocolData: ObsidianProtocolData) {
		try {
			const requestBody = new URLSearchParams({
				client_id: GRAPH_CLIENT_ID,
				scope: GRAPH_SCOPES.join(' '),
				code: protocolData['code'],
				redirect_uri: REDIRECT_URI,
				grant_type: 'authorization_code',
				state: protocolData['state'],
			});

			const tokenResponse: tokenResponse = await requestUrl({
				method: 'POST',
				url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
				contentType: 'application/x-www-form-urlencoded',
				body: requestBody.toString(),
			}).json;

			this.accessToken = tokenResponse.access_token;

			// Notify the OneNote importer that sign in is complete
			document.dispatchEvent(new Event('graphSignedIn'));
		}
		catch (e) {
			console.error('An error occurred while we were trying to sign you in. Error details: ', e);

			throw e;
		}
	}

	async requestUrl(url: string, returnType: string = 'json'): Promise<any | string | ArrayBuffer > {
    	try {
			let response = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
			let responseBody;
			
			switch (returnType) {
				case 'text':
					responseBody = await response.text();
					break;
				case 'file':
					responseBody = await response.arrayBuffer();
					break;
				default:
					responseBody = await response.json();
					break;
			}
			
			return responseBody;
		}
		catch (e) {
			console.error(`An error occurred while trying to fetch '${url}'. Error details: `, e);

			throw e;
		}
	}
}