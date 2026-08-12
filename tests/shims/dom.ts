/**
 * A DOM, and the handful of things Obsidian adds to it.
 *
 * The conversion code parses HTML and walks it, which node has no facility
 * for, so linkedom supplies the document and turndown supplies what Obsidian
 * exposes as window.TurndownService. The additions themselves are
 * web/obsidian/dom-extensions.ts, shared with the website - createEl appends
 * or does not, an attribute is omitted or written, and a conversion is built
 * on those either way, so there had better be one of them.
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
import { installDomExtensions } from '../../web/obsidian/dom-extensions';

// One window backs every parse, so nodes from different documents still share
// constructors - which is what the instanceOf checks rely on.
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

installDomExtensions(window, {
	turndown: TurndownService,
	// linkedom has no DOMImplementation, and a conversion that assembles its
	// output into a fresh document needs one to assemble into.
	createHTMLDocument: () => parseHTML('<!doctype html><html><body></body></html>').document,
});
