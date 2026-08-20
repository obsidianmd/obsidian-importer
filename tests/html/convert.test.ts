/**
 * The HTML conversion, outside Obsidian.
 *
 * An HTML file goes in and markdown comes out. Fetching an attachment and
 * deciding where it lands is the importer's, passed in as a callback, so the
 * resolver here reads the ones sitting next to the fixture and skips anything
 * remote - the recordings are then the same with or without a network.
 *
 * The vault paths in the recordings come from the resolver below rather than
 * from a real vault, but they follow the same rule the vault does: a name
 * already taken gets a number.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as nodeUrl from 'node:url';
import Defuddle from 'defuddle';

import { convertHtmlDocument, prepareHtmlDocument, ResolvedAttachment } from '../../src/formats/html/convert';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

/** What the importer falls back to when the source has no usable extension. */
const FALLBACK_EXTENSION: Record<string, string> = { IMG: 'png', AUDIO: 'mp3', VIDEO: 'mp4' };

/**
 * Stands in for the importer's downloadAttachment: reads what is on disk,
 * refuses to leave the fixture directory, and names the file the way the vault
 * would.
 */
function resolver(baseDirUrl: string, folder: string) {
	const taken = new Set<string>();

	return async (url: URL, el: HTMLElement): Promise<ResolvedAttachment | null> => {
		// Nothing remote, so a recording does not depend on a network.
		if (url.protocol !== 'file:') return null;
		if (!url.href.startsWith(baseDirUrl)) throw new Error('File path is outside the allowed directory');

		const filepath = nodeUrl.fileURLToPath(url.href);
		// Reading it is the point: a reference to a file that is not there
		// should fail rather than be recorded as an embed.
		nodeFs.readFileSync(filepath);

		const name = nodePath.basename(filepath);
		const ext = nodePath.extname(name).slice(1);
		const basename = ext ? nodePath.basename(name, `.${ext}`) : name;
		const extension = ext || FALLBACK_EXTENSION[el.tagName];
		if (!extension) return null;

		let candidate = `${basename}.${extension}`;
		for (let i = 1; taken.has(candidate); i++) candidate = `${basename} ${i}.${extension}`;
		taken.add(candidate);

		return { path: `${folder}/${candidate}`, name: candidate };
	};
}

const documents = fixtures(FIXTURES, '.html');

test('there are documents to convert', () => {
	assert.ok(documents.length > 0, 'expected at least one .html in tests/html');
});

for (const document of documents) {
	test(`converts ${document.name}`, async () => {
		const baseUrl = nodeUrl.pathToFileURL(document.path);
		const baseDirUrl = new URL('./', baseUrl.href).href;

		const skipped: string[] = [];
		const { markdown } = await convertHtmlDocument(nodeFs.readFileSync(document.path, 'utf8'), {
			baseUrl,
			resolveAttachment: resolver(baseDirUrl, 'Attachments'),
			onSkipped: src => skipped.push(src),
			onFailed: (src, e) => assert.fail(`${src}: ${e}`),
		});

		expectFile(markdown, expectedFor(document, `${nodePath.basename(document.name, '.html')}.md`), document.name);

		// Everything skipped should be remote: a local attachment failing to
		// resolve would otherwise disappear from the recording unremarked.
		for (const src of skipped) {
			assert.ok(/^(https?:)?\/\//.test(src), `unexpectedly skipped ${src}`);
		}
	});
}

test('resolves an attachment referred to twice only once', async () => {
	let calls = 0;
	const { markdown, attachments } = await convertHtmlDocument(
		'<p><img src="a.png"><img src="a.png"></p>',
		{
			baseUrl: new URL('file:///doc/index.html'),
			resolveAttachment: async () => {
				calls++;
				return { path: 'Attachments/a.png', name: 'a.png' };
			},
		});

	assert.equal(calls, 1);
	assert.equal(attachments.size, 1);
	assert.equal(markdown.match(/Attachments\/a\.png/g)?.length, 2);
});

test('leaves an inline data image alone', async () => {
	const { attachments } = await convertHtmlDocument(
		'<p><img src="data:image/png;base64,iVBORw0KGgo="></p>',
		{ resolveAttachment: async () => assert.fail('should not resolve a data: url') });

	assert.equal(attachments.size, 0);
});

test('reports a source it could not resolve rather than throwing', async () => {
	const failed: string[] = [];
	await convertHtmlDocument('<p><img src="a.png"></p>', {
		baseUrl: new URL('file:///doc/index.html'),
		resolveAttachment: async () => {
			throw new Error('no');
		},
		onFailed: src => failed.push(src),
	});

	assert.deepEqual(failed, ['a.png']);
});

test('carries audio and video through as embeds', async () => {
	const { markdown } = await convertHtmlDocument(
		'<p><audio src="a.mp3"></audio><video src="b.mp4"></video></p>',
		{
			baseUrl: new URL('file:///doc/index.html'),
			resolveAttachment: async url => {
				const name = nodePath.basename(url.pathname);
				return { path: `Attachments/${name}`, name };
			},
		});

	assert.match(markdown, /!\[\]\(Attachments\/a\.mp3\)/);
	assert.match(markdown, /!\[\]\(Attachments\/b\.mp4\)/);
});

test('rewrites heading IDs to the heading anchors Obsidian resolves', async () => {
	const { markdown } = await convertHtmlDocument(`
		<html><head><title>A book</title></head><body><main>
			<a href="#lexical-analysis">Lexical analysis</a>
			<h2 id="lexical-analysis">1.1 - Lexical Analysis</h2>
		</main></body></html>
	`, { resolveAttachment: async () => null });

	assert.match(markdown, /\[Lexical analysis\]\(#1\.1%20-%20Lexical%20Analysis\)/);
});

test('main-content extraction can be disabled', async () => {
	const html = `
		<html><head><title>Article</title></head><body>
			<nav><img src="https://example.com/logo.png">Navigation noise</nav>
			<main><article><h1>Article</h1>
				<p>This is the primary article body with enough words to be recognized as useful content.</p>
				<p>Another paragraph gives the extractor enough context to select this article.</p>
				<img src="https://example.com/article.png" alt="Article image">
			</article></main>
			<aside><table><tr><td>Sidebar noise</td></tr></table></aside>
			<footer>Footer noise</footer>
		</body></html>
	`;
	const options = { resolveAttachment: async () => null };

	const extracted = await convertHtmlDocument(html, options);
	const complete = await convertHtmlDocument(html, { ...options, extractMainContent: false });

	assert.doesNotMatch(extracted.markdown, /Navigation noise|Sidebar noise|Footer noise|logo\.png/);
	assert.match(extracted.markdown, /article\.png/);
	assert.match(complete.markdown, /Navigation noise/);
	assert.match(complete.markdown, /Sidebar noise/);
	assert.match(complete.markdown, /Footer noise/);
});

test('standardizes Bootstrap alerts without dropping their content', async () => {
	const { markdown } = await convertHtmlDocument(`
		<html><head><title>Bootstrap alerts</title></head><body><article>
			<p>Content before the alerts.</p>
			<div class="alert alert-info">
				<p class="alert-heading">Important</p>
				<p>This is an informational alert.</p>
			</div>
			<div class="alert alert-warning"><p>This is a warning.</p></div>
			<div class="alert alert-danger"><p>Something went wrong.</p></div>
			<div class="alert alert-success"><p>Operation completed successfully.</p></div>
			<p>Content after the alerts.</p>
		</article></body></html>
	`, { resolveAttachment: async () => null });

	assert.match(markdown, /This is an informational alert/);
});

test('uses the original page URL for format-specific extraction', async () => {
	const { markdown } = await convertHtmlDocument(`
		<html><head>
			<title>Improve the importer by test-owner · Pull Request #42</title>
			<meta name="expected-hostname" content="github.com">
			<meta property="og:url" content="https://github.com/test-owner/test-repo/pull/42">
		</head><body>
			<div class="pull-discussion-timeline">
				<div id="pullrequest-42" class="timeline-comment">
					<a class="author">original-author</a>
					<relative-time datetime="2026-08-01T00:00:00Z"></relative-time>
					<div class="comment-body markdown-body"><p>The pull request description survives extraction.</p></div>
				</div>
				<div class="review-comment">
					<a class="author">reviewer</a>
					<relative-time datetime="2026-08-02T00:00:00Z"></relative-time>
					<div class="comment-body markdown-body"><p>The review comment must survive too.</p></div>
				</div>
			</div>
		</body></html>
	`, {
		baseUrl: new URL('file:///export/pull-42.html'),
		resolveAttachment: async () => null,
	});

	assert.match(markdown, /The pull request description survives extraction/);
	assert.match(markdown, /The review comment must survive too/);
});

test('extracts React streaming content whose generated IDs need CSS escaping', async () => {
	const { markdown } = await convertHtmlDocument(`
		<html><head><title>How Many Airports Are There?</title></head><body>
			<header><nav>Home Guides About Contact</nav></header>
			<template id="B:0"></template>
			<div hidden id="S:a">
				<h1>How Many Airports Are There?</h1>
				<p>Counting airports sounds simple, but the number depends on what counts as an airport.</p>
				<p>Strict definitions include only certified facilities with scheduled passenger service.</p>
				<p>A broader count adds general aviation fields for private pilots and flight schools.</p>
				<p>Broader registries also include grass strips, heliports, and seaplane bases.</p>
				<p>Two sources can therefore be correct while reporting very different totals.</p>
				<p>The practical lesson is to check the definition before comparing the numbers.</p>
			</div>
			<template id="P:8"></template>
			<footer>Copyright Example Travel. Privacy Policy and Terms of Service.</footer>
		</body></html>
	`, { resolveAttachment: async () => null });

	assert.match(markdown, /Counting airports sounds simple/);
	assert.match(markdown, /check the definition before comparing the numbers/);
	assert.doesNotMatch(markdown, /Home Guides About Contact|Privacy Policy/);
});

test('falls back to the original document when extraction alters a protected reference', t => {
	t.mock.method(Defuddle.prototype, 'parse', () => ({
		title: 'Extracted',
		content: '<main><a href="https://obsidian-importer.invalid/reference/0/changed">Changed</a></main>',
	}) as never);

	const prepared = prepareHtmlDocument('<main><a href="kept.html">Kept</a></main>');

	assert.match(prepared.content, /href="kept\.html"/u);
	assert.doesNotMatch(prepared.content, /obsidian-importer\.invalid/u);
});
