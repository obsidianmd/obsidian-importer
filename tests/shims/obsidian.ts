/**
 * The `obsidian` module, as a test gets it.
 *
 * The half that behaves the same wherever a conversion runs - the YAML, the
 * markdown, the file classes - is web/obsidian/core.ts, shared with the
 * website so both produce the same notes and one set of recordings covers
 * both. What is left here is what only a test wants: a platform that is
 * neither Obsidian nor a browser, and stubs that throw, so a conversion
 * reaching for the app or for the network fails the test that runs it rather
 * than quietly reaching something.
 */
export * from '../../web/obsidian/core';

/**
 * Desktop, and not Obsidian.
 *
 * isDesktopApp is false so filesystem.ts does not try Electron's require at
 * import time; the test supplies node's real modules through
 * provideNodeModules instead.
 */
export const Platform = {
	isDesktopApp: false,
	isDesktop: true,
	isMobile: false,
	isMacOS: process.platform === 'darwin',
	isWin: process.platform === 'win32',
	isLinux: process.platform === 'linux',
};

/** The app's language, which nothing under test varies. */
export function getLanguage(): string {
	return 'en';
}

/**
 * A setting row, which a headless import never draws.
 *
 * FormatImporter.addSetting returns null when there is no dialog, so nothing
 * constructs this. It exists because the import of it is a value import, and
 * an absent binding fails at load rather than at use.
 */
export class Setting {
	constructor(_containerEl: unknown) {
		throw new Error('Setting cannot be drawn outside Obsidian');
	}
}

export class Plugin {
	constructor(_app: unknown, _manifest: unknown) {
		throw new Error('Plugin cannot be loaded outside Obsidian');
	}
}

export class Modal {
	constructor(_app: unknown) {
		throw new Error('Modal cannot be opened outside Obsidian');
	}
}

export class Notice {
	constructor(_message: string | DocumentFragment, _duration?: number) {
		throw new Error('Notice cannot be shown outside Obsidian');
	}
}

export class SearchComponent {
	constructor(_containerEl: unknown) {
		throw new Error('SearchComponent cannot be drawn outside Obsidian');
	}
}

export function setIcon(_el: unknown, _icon: string): void {
	throw new Error('setIcon is not available outside Obsidian');
}

export class SecretComponent {
	constructor(_app: unknown, _containerEl: unknown) {
		throw new Error('SecretComponent cannot be drawn outside Obsidian');
	}
}

export class AbstractInputSuggest<T> {
	constructor(_app: unknown, _textInputEl: unknown) {
		throw new Error('AbstractInputSuggest cannot be drawn outside Obsidian');
	}

	selectSuggestion(_value: T, _evt: unknown): void {}
}

export function prepareFuzzySearch(_query: string): never {
	throw new Error('prepareFuzzySearch is not available outside Obsidian');
}

export function renderMatches(_el: unknown, _text: string, _matches: unknown): never {
	throw new Error('renderMatches is not available outside Obsidian');
}

export function sortSearchResults(_results: unknown[]): never {
	throw new Error('sortSearchResults is not available outside Obsidian');
}

type Request = { url: string, method?: string, headers?: Record<string, string>, throw?: boolean };
type Response = { status: number, headers: Record<string, string>, arrayBuffer: ArrayBuffer };
type RequestHandler = (request: Request) => Response | Promise<Response>;

let requestHandler: RequestHandler = request => {
	throw new Error(`No answer prepared for ${request.method ?? 'GET'} ${request.url}`);
};

export function answerRequests(handler: RequestHandler): RequestHandler {
	const previous = requestHandler;
	requestHandler = handler;
	return previous;
}

export function requestUrl(request: Request): never {
	return requestHandler(request) as never;
}
