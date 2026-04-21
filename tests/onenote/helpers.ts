/**
 * Shared test helpers for OneNote converter tests.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import TurndownService from 'turndown';
// @ts-expect-error – no bundled types in the package
import { gfm } from '@joplin/turndown-plugin-gfm';

import {
	convertTags,
	combineCodeBlocksAsNecessary,
	styledElementToHTML,
	convertInternalLinks,
	removeExtraListItemParagraphs,
	escapeTextNodes,
} from '../../src/formats/onenote/onenote-converter';

export const __dirname = dirname(fileURLToPath(import.meta.url));

/** Build a turndown instance that matches the Obsidian htmlToMarkdown configuration. */
export function makeTurndown(): TurndownService {
	const td = new TurndownService({ bulletListMarker: '-' });
	td.use(gfm);
	// Obsidian's htmlToMarkdown passes <pre> content through verbatim rather
	// than escaping it, because styledElementToHTML already wrote the fenced
	// code markers (``` … ```) as raw text into the <pre> innerHTML.  Without
	// this rule, turndown escapes the backticks.
	td.addRule('pre-verbatim', {
		filter: 'pre',
		replacement(_content, node) {
			return '\n\n' + (node as HTMLElement).textContent + '\n\n';
		},
	});
	return td;
}

/**
 * Load a fixture file, run the full conversion pipeline, and return the
 * resulting Markdown string.  Simulates what OneNoteImporter.processFile
 * does, minus attachment downloading and the format-splitting step.
 *
 * Uses the global document provided by vitest's jsdom environment so that
 * instanceof HTMLElement checks inside the converter work correctly.
 */
export function convertFixture(filename: string): string {
	const fixtureHtml = readFileSync(resolve(__dirname, filename), 'utf8');

	// Use the vitest jsdom global document so that instanceof checks in the
	// converter functions resolve against the same HTMLElement class.
	// Extract just the <body> content to avoid loading <head> metadata.
	const bodyMatch = fixtureHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	document.body.innerHTML = bodyMatch ? bodyMatch[1] : fixtureHtml;
	const body = document.body as HTMLElement;

	// Run the conversion pipeline in the same order as processFile
	convertTags(body);
	combineCodeBlocksAsNecessary(body);
	styledElementToHTML(body);
	convertInternalLinks(body);
	removeExtraListItemParagraphs(body);
	escapeTextNodes(body);

	return makeTurndown().turndown(body.innerHTML);
}
