import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixDocumentHeadingLinks, rewriteSameDocumentHeadingHref } from '../../src/formats/html/heading-links';

const headingTextById = new Map([
	['lexing', 'Lexing'],
	['lexical-analysis', '1.1 - Lexical Analysis'],
	['start-of-a-repl', '1.5 - Start of a REPL'],
	['encoded heading', 'Encoded Heading'],
]);

test('rewrites same-document heading id links to Obsidian heading text links', () => {
	assert.equal(
		rewriteSameDocumentHeadingHref('#lexical-analysis', headingTextById),
		'#1.1 - Lexical Analysis'
	);
	assert.equal(
		rewriteSameDocumentHeadingHref('#start-of-a-repl', headingTextById),
		'#1.5 - Start of a REPL'
	);
});

test('rewrites single-word heading ids to their exact heading text', () => {
	assert.equal(rewriteSameDocumentHeadingHref('#lexing', headingTextById), '#Lexing');
});

test('looks up percent-encoded same-document heading ids', () => {
	assert.equal(rewriteSameDocumentHeadingHref('#encoded%20heading', headingTextById), '#Encoded Heading');
});

test('leaves non-heading and non-local hashes unchanged', () => {
	assert.equal(rewriteSameDocumentHeadingHref('#missing', headingTextById), null);
	assert.equal(rewriteSameDocumentHeadingHref('#', headingTextById), null);
	assert.equal(rewriteSameDocumentHeadingHref('book.html#lexical-analysis', headingTextById), null);
	assert.equal(rewriteSameDocumentHeadingHref('https://example.com#lexical-analysis', headingTextById), null);
});

test('updates same-document HTML anchors using matching heading ids', () => {
	const heading = new TestElement({ id: 'lexical-analysis' }, '1.1 - Lexical Analysis');
	const localAnchor = new TestElement({ href: '#lexical-analysis' });
	const externalAnchor = new TestElement({ href: 'book.html#lexical-analysis' });
	const root = new TestRoot([heading], [localAnchor, externalAnchor]);

	fixDocumentHeadingLinks(root as unknown as Element);

	assert.equal(localAnchor.getAttribute('href'), '#1.1 - Lexical Analysis');
	assert.equal(externalAnchor.getAttribute('href'), 'book.html#lexical-analysis');
});

class TestRoot {
	constructor(
		private headings: TestElement[],
		private anchors: TestElement[]
	) {}

	findAll(selector: string) {
		if (selector === 'h1, h2, h3, h4, h5, h6') return this.headings;
		if (selector === 'a') return this.anchors;
		return [];
	}
}

class TestElement {
	constructor(
		private attrs: Record<string, string>,
		public textContent: string = ''
	) {}

	getAttribute(name: string) {
		return this.attrs[name] ?? null;
	}

	setAttribute(name: string, value: string) {
		this.attrs[name] = value;
	}
}
