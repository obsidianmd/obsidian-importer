/**
 * The Evernote conversion, end to end, outside Obsidian.
 *
 * yarle reads .enex and writes markdown through the node modules that
 * filesystem.ts hands out, and never touches the vault, so the whole pipeline
 * runs here once those modules are supplied. What it produces is compared
 * against the .enex files in this directory.
 *
 * This is a regression check rather than a fidelity one: Obsidian bundles its
 * own turndown build, so the exact markdown can differ from what ships. See
 * tests/shims/dom.ts.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';

import { defaultYarleOptions, dropTheRope } from '../../src/formats/yarle/yarle';

// Before any conversion runs. yarle reads these when it works, not when it
// loads, so a static import above is fine.
provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// tsx runs these as CommonJS, so __dirname rather than import.meta.
const FIXTURES = __dirname;

/** Enough of ImportContext for the conversion path, plus what it recorded. */
function stubContext() {
	return {
		notes: [] as string[],
		failures: [] as string[],
		skips: [] as string[],
		statusMessage: '',
		status(message: string) { this.statusMessage = message; },
		reportNoteSuccess(name: string) { this.notes.push(name); },
		reportAttachmentSuccess() { },
		reportSkipped(name: string) { this.skips.push(String(name)); },
		reportFailed(name: string, reason?: unknown) { this.failures.push(`${String(name)}: ${String(reason)}`); },
		reportProgress() { },
		isCancelled() { return false; },
		cancel() { },
		hideStatus() { },
	};
}

/** Convert the named fixtures and return every file produced, by relative path. */
async function convert(...fixtures: string[]) {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-'));
	const ctx = stubContext();

	try {
		await dropTheRope({
			...defaultYarleOptions,
			enexSources: fixtures.map(name => new NodePickedFile(nodePath.join(FIXTURES, name))),
			outputDir,
		}, ctx as never);

		const files: Record<string, string> = {};
		const walk = (dir: string) => {
			for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
				const full = nodePath.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else files[nodePath.relative(outputDir, full).split(nodePath.sep).join('/')] = nodeFs.readFileSync(full, 'utf8');
			}
		};
		walk(outputDir);
		return { files, ctx };
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

test('converts every fixture without failing a note', async () => {
	const { files, ctx } = await convert(
		'source-of-webclip.enex',
		'test-file-with-many-dots.enex',
		'test-internotebook_links_A.enex',
		'test-internotebook_links_B.enex',
		'test-resource-attributes-single-child.enex',
	);

	assert.deepEqual(ctx.failures, [], 'no note should fail to convert');
	assert.equal(ctx.notes.length, 10);
	assert.ok(Object.keys(files).length > 0, 'should have written files');
});

test('keeps a resource file name that is its only attribute', async () => {
	// xml-flow hands back the child's value rather than an object when
	// resource-attributes holds a single child, which used to lose the name and
	// write the attachment as "unknown_filename".
	const { files } = await convert('test-resource-attributes-single-child.enex');
	const attachments = Object.keys(files).filter(p => p.endsWith('.png'));

	assert.equal(attachments.length, 2);
	for (const path of attachments) {
		assert.ok(path.endsWith('/dot.png'), `expected dot.png, got ${path}`);
	}
});

test('keeps every dot in a resource file name', async () => {
	const { files } = await convert('test-file-with-many-dots.enex');
	const attachment = Object.keys(files).find(p => p.includes('.resources/'));

	assert.ok(attachment?.endsWith('/test.file.with.many.dots.txt'), `got ${attachment}`);
});

test('embeds the attachment in the note that carried it', async () => {
	const { files } = await convert('test-file-with-many-dots.enex');
	const note = files['test-file-with-many-dots/Test with files contains multiple dots.md'];

	assert.ok(note, 'note should exist');
	assert.match(note, /!\[\[.*test\.file\.with\.many\.dots\.txt\]\]/);
});

test('resolves a link into another notebook', async () => {
	const { files } = await convert('test-internotebook_links_A.enex', 'test-internotebook_links_B.enex');
	const note = files['test-internotebook_links_B/Note in Notebook B.md'];

	assert.ok(note, 'note should exist');
	assert.match(note, /\[\[test-internotebook_links_A\/Note in Notebook A\]\]/);
});

test('carries a web clip source url into frontmatter', async () => {
	const { files } = await convert('source-of-webclip.enex');
	const note = Object.values(files).find(c => c.includes('source:'));

	assert.ok(note, 'a note should carry a source');
	assert.match(note, /source: http:\/\/www\.blankwebsite\.com\//);
});

test('writes tags as a frontmatter list', async () => {
	const { files } = await convert('test-file-with-many-dots.enex');
	const note = files['test-file-with-many-dots/Test with files contains multiple dots.md'];

	assert.match(note, /tags:\s*\n\s*- Tipps/);
});
