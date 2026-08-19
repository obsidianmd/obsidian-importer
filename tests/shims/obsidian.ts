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

/** Minimal DOM-backed Setting used by progress UI tests. */
export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv('setting-item');
		this.infoEl = this.settingEl.createDiv('setting-item-info');
		this.nameEl = this.infoEl.createDiv('setting-item-name');
		this.descEl = this.infoEl.createDiv('setting-item-description');
		this.controlEl = this.settingEl.createDiv('setting-item-control');
	}

	setName(name: string | DocumentFragment): this {
		this.nameEl.setText(name);
		return this;
	}

	setDesc(desc: string | DocumentFragment): this {
		this.descEl.setText(desc);
		return this;
	}

	setClass(cls: string): this {
		this.settingEl.classList.add(cls);
		return this;
	}

	addProgressBar(cb: (component: ProgressBarComponent) => unknown): this {
		cb(new ProgressBarComponent(this.controlEl));
		return this;
	}
}

export class SettingGroup {
	groupEl: HTMLElement;
	listEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.groupEl = containerEl.createDiv('setting-group');
		this.listEl = this.groupEl.createDiv('setting-items');
	}

	addClass(cls: string): this {
		this.groupEl.classList.add(cls);
		return this;
	}

	setHeading(text: string): this {
		this.groupEl.createDiv('setting-item setting-item-heading')
			.createDiv({ cls: 'setting-item-name', text });
		return this;
	}
}

export class ProgressBarComponent {
	private value: number = 0;
	private innerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.innerEl = containerEl.createDiv('setting-progress-bar')
			.createDiv('setting-progress-bar-inner');
	}

	getValue(): number {
		return this.value;
	}

	setValue(value: number): this {
		this.value = Math.max(0, Math.min(100, value));
		this.innerEl.style.width = `${this.value}%`;
		return this;
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
