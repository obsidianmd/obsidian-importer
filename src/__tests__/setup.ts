/**
 * Vitest global setup — provides a minimal DOM environment for tests
 * that parse HTML (e.g. Apple Journal importer).
 *
 * The importers call `parseHTML` which relies on DOMParser, document, etc.
 * We polyfill these with jsdom when they are missing.
 */

import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	const window = dom.window;

	// Patch globals that the importers and obsidian mock rely on
	globalThis.DOMParser = window.DOMParser as any;
	globalThis.document = window.document as any;
	globalThis.HTMLElement = window.HTMLElement as any;
	globalThis.DocumentFragment = window.DocumentFragment as any;
	globalThis.Element = window.Element as any;
	globalThis.Node = window.Node as any;
}

// Provide a minimal `Object.isEmpty` used by serializeFrontMatter in util.ts.
// The real Obsidian runtime monkey-patches Object with this helper.
if (typeof (Object as any).isEmpty !== 'function') {
	(Object as any).isEmpty = function (obj: any): boolean {
		if (obj == null) return true;
		return Object.keys(obj).length === 0;
	};
}
