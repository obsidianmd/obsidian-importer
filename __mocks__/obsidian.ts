/**
 * Mock for the 'obsidian' module.
 *
 * The obsidian package is only available inside the Obsidian desktop/mobile
 * app at runtime. This mock provides the minimal surface area needed to
 * unit-test pure utility functions that happen to import from 'obsidian'.
 *
 * Extend this file as new tests need additional exports.
 */

// ---- Types (re-exported as empty interfaces / type aliases) ----

export interface FrontMatterCache {
	[key: string]: any;
}

export interface CachedMetadata {
	frontmatter?: FrontMatterCache;
}

export interface BasesConfigFile {
	[key: string]: any;
}

export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
	vault: any = null;
	parent: any = null;
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder {
	path = '';
	name = '';
	children: any[] = [];
	parent: any = null;
	vault: any = null;
	isRoot() { return this.path === '/'; }
}

export class TAbstractFile {
	path = '';
	name = '';
	vault: any = null;
	parent: any = null;
}

export const Platform = {
	isDesktopApp: false,
	isMobileApp: false,
	isMobile: false,
	isDesktop: true,
};

// ---- Functions ----

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function stringifyYaml(obj: any): string {
	// Minimal YAML serializer for test purposes.
	// Only handles flat key-value objects (which is the common case in frontmatter).
	const lines: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (value === null || value === undefined) {
			lines.push(`${key}: `);
		}
		else if (typeof value === 'string') {
			lines.push(`${key}: ${value}`);
		}
		else {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		}
	}
	return lines.join('\n') + '\n';
}

export function htmlToMarkdown(html: string): string {
	// Stub — returns the raw HTML. Individual importer tests that need
	// real conversion should provide their own mock.
	return html;
}

export function parseLinktext(linktext: string) {
	return { path: linktext, subpath: '' };
}

export function requestUrl(_url: string | { url: string }): Promise<any> {
	return Promise.resolve({ text: '', json: {}, arrayBuffer: new ArrayBuffer(0) });
}

export function moment(...args: any[]) {
	// Stub — tests that depend on moment should mock it specifically.
	return {
		format: () => '',
		isValid: () => true,
		toISOString: () => '',
	};
}

// ---- UI stubs (no-ops in tests) ----

export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class Setting {
	constructor(_containerEl: any) {}
	setName() { return this; }
	setDesc() { return this; }
	addText() { return this; }
	addTextArea() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
	addButton() { return this; }
	addSlider() { return this; }
	setClass() { return this; }
	setDisabled() { return this; }
}

export class Modal {
	app: any;
	contentEl: any = {};
	constructor(app: any) { this.app = app; }
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class Plugin {
	app: any;
	manifest: any = {};
	constructor(app: any, manifest: any) { this.app = app; this.manifest = manifest; }
	loadData() { return Promise.resolve({}); }
	saveData() { return Promise.resolve(); }
}

export class App {
	vault: any = {};
	workspace: any = {};
	metadataCache: any = {};
}

export class Vault {
	getAbstractFileByPath() { return null; }
	create() { return Promise.resolve(new TFile()); }
	modify() { return Promise.resolve(); }
}

export function setIcon(_el: any, _iconId: string) {}

// ---- Augmentations used by the codebase ----

// Object.isEmpty is used in util.ts serializeFrontMatter
if (typeof Object.isEmpty === 'undefined') {
	Object.defineProperty(Object, 'isEmpty', {
		value: function (obj: any): boolean {
			if (obj == null) return true;
			return Object.keys(obj).length === 0;
		},
		writable: true,
		configurable: true,
	});
}
