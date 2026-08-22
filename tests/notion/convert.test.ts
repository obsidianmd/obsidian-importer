/**
 * The Notion export conversion, outside Obsidian.
 *
 * Notion exports a zip of HTML pages. The importer walks it twice: once to
 * note what every page and attachment is, so links between them can be
 * resolved, and again to convert each page. Both passes run here against the
 * export in this directory, and each page is recorded as the markdown a user
 * would get.
 *
 * The markdown comes out of the shim's htmlToMarkdown rather than Obsidian's.
 * That was checked rather than assumed: for the Formatting Tests page - which
 * exists to stress exactly this conversion - the two agree byte for byte. See
 * tests/shims/obsidian.ts.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { convertHtmlToMarkdown } from '../../src/formats/notion/convert-to-md';
import { NotionResolverInfo } from '../../src/formats/notion/notion-types';
import { getNotionId } from '../../src/formats/notion/notion-utils';
import { recordFileInfo } from '../../src/formats/notion/parse-info';
import { sanitizeFileName } from '../../src/util';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

interface ExportEntry {
	filepath: string;
	name: string;
	extension: string;
	text?: string;
}

/**
 * Every file in an export, following the zip Notion nests inside the one it
 * hands you.
 */
async function readExport(bytes: Uint8Array): Promise<ExportEntry[]> {
	const reader = new ZipReader(new BlobReader(new Blob([bytes as unknown as BlobPart])));
	const entries: ExportEntry[] = [];

	for (const entry of await reader.getEntries()) {
		if (entry.directory || !entry.getData) continue;

		const name = entry.filename.split('/').pop() ?? entry.filename;
		const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';

		if (extension === 'zip') {
			entries.push(...await readExport(await entry.getData(new Uint8ArrayWriter())));
			continue;
		}

		entries.push({
			filepath: entry.filename,
			name,
			extension,
			text: extension === 'html' ? await entry.getData(new TextWriter()) : undefined,
		});
	}

	await reader.close();
	return entries;
}

const exports_ = fixtures(FIXTURES, '.zip');

test('there are exports to convert', () => {
	assert.ok(exports_.length > 0, 'expected at least one .zip in tests/notion');
});

test('single line breaks compact adjacent Notion paragraphs', () => {
	const html = '<!doctype html><html><body><div class="page-body"><p>First paragraph</p><p>Second paragraph</p></div></body></html>';
	const spaced = convertHtmlToMarkdown(new NotionResolverInfo('', false), html);
	const tight = convertHtmlToMarkdown(new NotionResolverInfo('', true), html);

	assert.match(spaced, /First paragraph\n\nSecond paragraph/);
	assert.match(tight, /First paragraph\nSecond paragraph/);
	assert.doesNotMatch(tight, /First paragraph\n\nSecond paragraph/);
});

for (const exported of exports_) {
	test(`converts ${exported.name}`, async () => {
		const entries = await readExport(nodeFs.readFileSync(exported.path));
		// The importer only converts pages whose file name carries a Notion id;
		// the export's own index.html has none and never reaches conversion.
		const pages = entries.filter(entry => entry.extension === 'html' && getNotionId(entry.name));

		// A Markdown & CSV export holds nothing this conversion reads. What the
		// importer tells the user about one is markdown-export.test.ts.
		if (entries.some(entry => entry.extension === 'md' && getNotionId(entry.name))) {
			assert.deepEqual(pages, [], 'a Markdown export should have no HTML pages');
			return;
		}

		assert.ok(pages.length > 0, 'the export should contain pages');

		// First pass, as the importer does it: every entry is noted before any
		// page is converted, so a link from one page to another resolves.
		const info = new NotionResolverInfo('', false);
		for (const entry of entries) recordFileInfo(info, entry);

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-notion-'));
		try {
			for (const page of pages) {
				const markdown = convertHtmlToMarkdown(info, page.text ?? '');

				// Named the way the importer names it: from the title Notion
				// wrote into the page, through the same sanitiser.
				const title = /<title>([^]*?)<\/title>/.exec(page.text ?? '')?.[1]?.trim() || 'Untitled';
				nodeFs.writeFileSync(nodePath.join(produced, `${sanitizeFileName(title)}.md`), markdown);
			}

			expectTree(produced, expectedFor(exported, nodePath.basename(exported.name, '.zip')), exported.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}
