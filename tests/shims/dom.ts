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

globals.window = window;
(window as unknown as Record<string, unknown>).TurndownService = TurndownService;

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
define(elementProto, 'getAttr', function (this: any, name: string) { return this.getAttribute(name); });
define(elementProto, 'setAttr', function (this: any, name: string, value: string) { this.setAttribute(name, String(value)); });
define(documentProto, 'find', function (this: any, selector: string) { return this.querySelector(selector); });
define(documentProto, 'findAll', function (this: any, selector: string) { return Array.from(this.querySelectorAll(selector)); });

/** createEl and friends, detached - matching what Obsidian's globals do. */
function createEl(tag: string, options?: { text?: string, cls?: string, attr?: Record<string, string> }) {
	const el = window.document.createElement(tag);
	if (options?.text) el.textContent = options.text;
	if (options?.cls) el.className = options.cls;
	for (const [name, value] of Object.entries(options?.attr ?? {})) el.setAttribute(name, String(value));
	return el;
}

globals.createEl = createEl;
globals.createDiv = (options?: object) => createEl('div', options);
globals.createSpan = (options?: object) => createEl('span', options);
globals.createFragment = () => window.document.createDocumentFragment();
define(window as any, 'createEl', createEl);
