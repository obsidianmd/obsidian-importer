/**
 * A DOM, and the handful of things Obsidian adds to it.
 *
 * The conversion code parses HTML and walks it, which node has no facility
 * for, so linkedom supplies the document and turndown supplies what Obsidian
 * exposes as window.TurndownService.
 *
 * What this is and is not:
 *
 * - It IS a regression check. Given the same input, the conversion should keep
 *   producing the same output, and this catches it when it does not.
 * - It is NOT a fidelity check. Obsidian bundles its own turndown build and
 *   does not report its version, so the markdown here can differ in detail
 *   from what ships. Only running inside Obsidian settles that.
 *
 * Import this for side effects before anything that touches the DOM.
 */
import './runtime';

import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

// One window backs every parse, so nodes from different documents still share
// constructors - which is what the instanceOf checks below rely on.
const { window } = parseHTML('<!doctype html><html><body></body></html>');

const globals = globalThis as unknown as Record<string, unknown>;

for (const name of [
	'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'HTMLImageElement',
	'HTMLParagraphElement', 'HTMLQuoteElement', 'HTMLAnchorElement', 'HTMLTableRowElement',
	'HTMLTableCellElement', 'HTMLTableSectionElement', 'NodeFilter', 'Text', 'Comment',
]) {
	const value = (window as unknown as Record<string, unknown>)[name];
	if (value !== undefined) globals[name] = value;
}

/**
 * linkedom has createTreeWalker but no NodeFilter, so the constants callers
 * pass it have to come from somewhere. These are the values from the DOM
 * standard.
 */
if (globals.NodeFilter === undefined) {
	globals.NodeFilter = {
		SHOW_ALL: 0xFFFFFFFF, SHOW_ELEMENT: 1, SHOW_ATTRIBUTE: 2, SHOW_TEXT: 4,
		SHOW_CDATA_SECTION: 8, SHOW_COMMENT: 128, SHOW_DOCUMENT: 256,
		SHOW_DOCUMENT_FRAGMENT: 1024,
		FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3,
	};
}

globals.window = window;
(window as unknown as Record<string, unknown>).TurndownService = TurndownService;

// Obsidian's handle on the document of whichever window has focus. Headless
// there is only the one.
globals.activeDocument = window.document;

/**
 * linkedom has no DOMImplementation, and a conversion that assembles its output
 * into a fresh document needs one to assemble into.
 */
if ((window.document as unknown as { implementation?: unknown }).implementation === undefined) {
	Object.defineProperty(window.document, 'implementation', {
		value: {
			createHTMLDocument: () => parseHTML('<!doctype html><html><body></body></html>').document,
		},
	});
}

/**
 * Obsidian's additions to Node and Element.
 *
 * Only the ones the conversion path uses. instanceOf is Obsidian's
 * cross-window instanceof; here there is one window, so it is the plain check.
 */
const nodeProto = (window as unknown as { Node: { prototype: any } }).Node.prototype;
const elementProto = (window as unknown as { Element: { prototype: any } }).Element.prototype;
const documentProto = (window as unknown as { Document: { prototype: any } }).Document.prototype;

function define(proto: any, name: string, value: unknown) {
	if (!(name in proto)) Object.defineProperty(proto, name, { value, writable: true, configurable: true });
}

define(nodeProto, 'instanceOf', function (this: any, type: any) { return this instanceof type; });
Object.defineProperty(nodeProto, 'doc', {
	get(this: any) { return this.ownerDocument ?? window.document; },
	configurable: true,
});
Object.defineProperty(nodeProto, 'win', { get() { return window; }, configurable: true });

define(elementProto, 'find', function (this: any, selector: string) { return this.querySelector(selector); });
define(elementProto, 'findAll', function (this: any, selector: string) { return Array.from(this.querySelectorAll(selector)); });
define(elementProto, 'appendText', function (this: any, text: string) { this.appendChild(this.doc.createTextNode(text)); });
define(elementProto, 'empty', function (this: any) { while (this.firstChild) this.removeChild(this.firstChild); });
/**
 * linkedom exposes innerText read-only; browsers and Obsidian let you assign
 * it, and the conversion code does. Backed by textContent, which is what
 * linkedom's own getter reads.
 */
if (!Object.getOwnPropertyDescriptor(elementProto, 'innerText')?.set) {
	Object.defineProperty(elementProto, 'innerText', {
		get(this: any) { return this.textContent; },
		set(this: any, value: string) { this.textContent = value; },
		configurable: true,
	});
}

define(elementProto, 'setText', function (this: any, text: unknown) {
	if (text && typeof text === 'object' && 'nodeType' in (text as object)) {
		this.textContent = '';
		this.appendChild(text);
	}
	else this.textContent = String(text);
});
define(elementProto, 'getAttr', function (this: any, name: string) { return this.getAttribute(name); });
define(elementProto, 'setAttr', function (this: any, name: string, value: string) { this.setAttribute(name, String(value)); });
define(documentProto, 'find', function (this: any, selector: string) { return this.querySelector(selector); });
define(documentProto, 'findAll', function (this: any, selector: string) { return Array.from(this.querySelectorAll(selector)); });

/** createEl and friends, detached - matching what Obsidian's globals do. */
function createEl(tag: string, options?: { text?: string, cls?: string, attr?: Record<string, unknown> }) {
	const el = window.document.createElement(tag);
	if (options?.text) el.textContent = options.text;
	if (options?.cls) el.className = options.cls;
	for (const [name, value] of Object.entries(options?.attr ?? {})) {
		// null leaves the attribute off; undefined does not, which is
		// Obsidian's behaviour rather than an oversight here.
		if (value === null) continue;
		el.setAttribute(name, String(value));
	}
	return el;
}

/**
 * The element methods append; the globals below do not. That difference is
 * Obsidian's, and code here relies on both.
 */
define(elementProto, 'createEl', function (this: any, tag: string, options?: object) {
	const child = createEl(tag, options);
	this.appendChild(child);
	return child;
});
define(elementProto, 'createDiv', function (this: any, options?: object) { return this.createEl('div', options); });
define(elementProto, 'createSpan', function (this: any, options?: object) { return this.createEl('span', options); });

globals.createEl = createEl;
globals.createDiv = (options?: object) => createEl('div', options);
globals.createSpan = (options?: object) => createEl('span', options);
globals.createFragment = () => window.document.createDocumentFragment();
define(window as any, 'createEl', createEl);
