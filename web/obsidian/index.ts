/**
 * The `obsidian` module, as the website gets it.
 *
 * The shared half is ./core, the same one the tests run against. What is added
 * here is what only a browser can answer: which platform this is, what
 * language the reader has, how a request is made without Electron behind it,
 * and how a notice is shown when there is no app to show it in.
 *
 * The drawing API is still stubbed. An importer builds its options in init()
 * through `Setting`, and FormatImporter.addSetting returns null when the host
 * has no element to draw into - which is how the scripted import in main.ts
 * already runs one headlessly. The website takes that path for now, so
 * nothing constructs a Setting; giving these real bodies is what turns the
 * importers' own options back on.
 */
export * from './core';

/**
 * A browser, and not Obsidian.
 *
 * isDesktopApp is false so filesystem.ts does not try Electron's require at
 * import time. The website supplies what it can of node through
 * provideNodeModules instead, and the importers that need the rest of it say
 * so by setting notAvailable.
 */
export const Platform = {
	isDesktopApp: false,
	isDesktop: !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
	isMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
	isMacOS: /Mac/i.test(navigator.platform),
	isWin: /Win/i.test(navigator.platform),
	isLinux: /Linux/i.test(navigator.platform) && !/Android/i.test(navigator.userAgent),
};

/**
 * The reader's language, in the form the string table is keyed by.
 *
 * Obsidian reports "en" or "zh-TW"; a browser reports "en-GB" for a reader the
 * table has only "en" for, so the region is dropped unless the table carries
 * that exact tag.
 */
export function getLanguage(): string {
	return navigator.language || 'en';
}

/** Where a Notice goes, once the page has somewhere to put one. */
let noticeContainer: HTMLElement | null = null;

export function setNoticeContainer(el: HTMLElement): void {
	noticeContainer = el;
}

/**
 * A message that shows and then goes away.
 *
 * Importers report through ImportContext, which the page draws itself; this is
 * for the handful of things they say outside a run.
 */
export class Notice {
	noticeEl: HTMLElement;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(message: string | DocumentFragment, duration: number = 5000) {
		const el = document.createElement('div');
		el.className = 'notice';
		if (typeof message === 'string') el.textContent = message;
		else el.appendChild(message);

		this.noticeEl = el;
		(noticeContainer ?? document.body).appendChild(el);

		el.addEventListener('click', () => this.hide());
		if (duration > 0) this.timer = setTimeout(() => this.hide(), duration);
	}

	setMessage(message: string | DocumentFragment): this {
		if (typeof message === 'string') this.noticeEl.textContent = message;
		else {
			this.noticeEl.textContent = '';
			this.noticeEl.appendChild(message);
		}
		return this;
	}

	hide(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.noticeEl.remove();
	}
}

/** Obsidian's icons are its own; a website draws its own affordances. */
export function setIcon(_el: unknown, _icon: string): void {}

type RequestUrlParam = {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
};

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: unknown;
	text: string;
}

/**
 * requestUrl, over fetch.
 *
 * In Obsidian this is deliberately not the browser's request: it is not bound
 * by CORS, which is why the plugin downloads attachments with it. Here it is
 * exactly the browser's request and CORS applies, so a host that does not
 * offer the page its content simply cannot be read from this side. Measured:
 * Airtable and Microsoft Graph both answer a browser; Notion answers none of
 * it, and needs the proxy standing in front.
 *
 * `throw: false` is the only option the importers vary, and it means report
 * the status rather than raise.
 */
export function requestUrl(request: string | RequestUrlParam) {
	const param: RequestUrlParam = typeof request === 'string' ? { url: request } : request;

	const response = (async (): Promise<RequestUrlResponse> => {
		const headers = { ...param.headers };
		if (param.contentType) headers['Content-Type'] = param.contentType;

		const answer = await fetch(param.url, {
			method: param.method ?? 'GET',
			headers,
			body: param.body as BodyInit | undefined,
		});

		const arrayBuffer = await answer.arrayBuffer();
		const text = new TextDecoder().decode(arrayBuffer);

		if (answer.status >= 400 && param.throw !== false) {
			throw new Error(`Request failed, status ${answer.status}: ${param.url}`);
		}

		return {
			status: answer.status,
			headers: Object.fromEntries(answer.headers.entries()),
			arrayBuffer,
			text,
			get json() {
				return JSON.parse(text);
			},
		};
	})();

	// Obsidian's returns a promise carrying each part as its own promise, and
	// the importers use both forms: `(await requestUrl(x)).json` and
	// `await requestUrl(x).json`.
	return Object.assign(response, {
		get arrayBuffer() { return response.then(r => r.arrayBuffer); },
		get json() { return response.then(r => r.json); },
		get text() { return response.then(r => r.text); },
		get status() { return response.then(r => r.status); },
		get headers() { return response.then(r => r.headers); },
	});
}

/**
 * The drawing API, which nothing on this path constructs yet.
 *
 * Value imports, so an absent binding fails at load rather than at use - the
 * same reason the test shim carries them.
 */
export class Setting {
	constructor(_containerEl: unknown) {
		throw new Error('Setting is not drawn on the website yet');
	}
}

export class Plugin {
	constructor(_app: unknown, _manifest: unknown) {
		throw new Error('There is no plugin on the website');
	}
}

export class Modal {
	constructor(_app: unknown) {
		throw new Error('Modal is not drawn on the website');
	}
}

export class SearchComponent {
	constructor(_containerEl: unknown) {
		throw new Error('SearchComponent is not drawn on the website yet');
	}
}

export class SecretComponent {
	constructor(_app: unknown, _containerEl: unknown) {
		throw new Error('SecretComponent is not drawn on the website yet');
	}
}

export class AbstractInputSuggest<T> {
	constructor(_app: unknown, _textInputEl: unknown) {
		throw new Error('AbstractInputSuggest is not drawn on the website yet');
	}

	selectSuggestion(_value: T, _evt: unknown): void {}
}

export function prepareFuzzySearch(_query: string): never {
	throw new Error('prepareFuzzySearch is not available on the website');
}

export function renderMatches(_el: unknown, _text: string, _matches: unknown): never {
	throw new Error('renderMatches is not available on the website');
}

export function sortSearchResults(_results: unknown[]): never {
	throw new Error('sortSearchResults is not available on the website');
}
