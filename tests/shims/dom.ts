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

if ((window as unknown as Record<string, unknown>).requestAnimationFrame === undefined) {
	define(window as any, 'requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(0), 0));
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
// Obsidian adds these methods to Node, including DocumentFragment.
define(nodeProto, 'appendText', function (this: any, text: string) {
	this.appendChild((this.ownerDocument ?? this.doc ?? window.document).createTextNode(text));
});
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
define(elementProto, 'hide', function (this: any) { this.style.display = 'none'; });
define(elementProto, 'show', function (this: any) { this.style.removeProperty('display'); });
define(elementProto, 'toggle', function (this: any, shown: boolean) {
	if (shown) this.show();
	else this.hide();
});
define(elementProto, 'toggleClass', function (this: any, classes: string | string[], value: boolean) {
	for (const cls of Array.isArray(classes) ? classes : [classes]) this.classList.toggle(cls, value);
});

define(elementProto, 'getAttr', function (this: any, name: string) { return this.getAttribute(name); });
define(elementProto, 'setAttr', function (this: any, name: string, value: string) { this.setAttribute(name, String(value)); });

/**
 * rows and cells, which linkedom has neither of.
 *
 * The Notion conversion reads a page's property table through them - the rows
 * of the <tbody>, then each row's cells - so without them the whole
 * property-to-frontmatter path throws before it converts anything.
 *
 * linkedom gives every element the plain HTMLElement prototype, so these land
 * on Element rather than on HTMLTableSectionElement and HTMLTableRowElement
 * where the DOM puts them. turndown's GFM table rules read .rows as well, so
 * <table> has to gather the rows of its sections rather than only its own
 * children, or those rules see an empty table.
 *
 * Document order, where the DOM hoists thead first and sinks tfoot last. No
 * export here writes either, and guessing at more would be inventing rather
 * than matching.
 */
function childElements(el: any, tags: string[]): any[] {
	return (Array.from(el.children) as any[]).filter(child => tags.includes(child.tagName));
}

if (!('rows' in elementProto)) {
	Object.defineProperty(elementProto, 'rows', {
		get(this: any) {
			if (this.tagName !== 'TABLE') return childElements(this, ['TR']);

			const rows: any[] = [];
			for (const child of Array.from(this.children) as any[]) {
				if (child.tagName === 'TR') rows.push(child);
				else if (child.tagName === 'THEAD' || child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
					rows.push(...childElements(child, ['TR']));
				}
			}
			return rows;
		},
		configurable: true,
	});
}

if (!('cells' in elementProto)) {
	Object.defineProperty(elementProto, 'cells', {
		get(this: any) { return childElements(this, ['TD', 'TH']); },
		configurable: true,
	});
}
define(documentProto, 'find', function (this: any, selector: string) { return this.querySelector(selector); });
define(documentProto, 'findAll', function (this: any, selector: string) { return Array.from(this.querySelectorAll(selector)); });

type ElementInfo = { text?: string, cls?: string, attr?: Record<string, unknown> };

function elementInfo(options?: ElementInfo | string): ElementInfo | undefined {
	return typeof options === 'string' ? { cls: options } : options;
}

/** Detached equivalent of Obsidian's createEl. */
function createEl(tag: string, info?: ElementInfo | string, build?: (el: any) => void) {
	const options = elementInfo(info);
	const el = window.document.createElement(tag);
	if (options?.text) el.textContent = options.text;
	if (options?.cls) el.className = options.cls;
	for (const [name, value] of Object.entries(options?.attr ?? {})) {
		// null leaves the attribute off; undefined does not, which is
		// Obsidian's behaviour rather than an oversight here.
		if (value === null) continue;
		el.setAttribute(name, String(value));
	}
	build?.(el);
	return el;
}

/**
 * The element methods append; the globals below do not. That difference is
 * Obsidian's, and code here relies on both.
 */
define(nodeProto, 'createEl', function (this: any, tag: string, options?: ElementInfo | string, build?: (el: any) => void) {
	const child = createEl(tag, options, build);
	this.appendChild(child);
	return child;
});
define(nodeProto, 'createDiv', function (this: any, options?: ElementInfo | string, build?: (el: any) => void) {
	return this.createEl('div', options, build);
});
define(nodeProto, 'createSpan', function (this: any, options?: ElementInfo | string, build?: (el: any) => void) {
	return this.createEl('span', options, build);
});

globals.createEl = createEl;
globals.createDiv = (options?: ElementInfo | string, build?: (el: any) => void) => createEl('div', options, build);
globals.createSpan = (options?: ElementInfo | string, build?: (el: any) => void) => createEl('span', options, build);
globals.createFragment = () => window.document.createDocumentFragment();
define(window as any, 'createEl', createEl);
