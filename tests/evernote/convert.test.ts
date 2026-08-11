import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodePath from 'node:path';

import { expectedFor, expectTree, fixtures, readTree } from '../helpers';
import { Context, importEnex, inTempDir, notebookDir } from './harness';

// tsx runs these as CommonJS, so __dirname rather than import.meta.
const FIXTURES = __dirname;

async function convert<T>(paths: string[], use: (outputDir: string, ctx: Context) => T): Promise<T> {
	let answer!: T;

	await inTempDir(async outputDir => {
		answer = use(outputDir, await importEnex(outputDir, paths));
	});

	return answer;
}

// The ones from Yarle sit in their own directory, with their provenance and
// what was left out written down beside them.
const enexFiles = [...fixtures(FIXTURES, '.enex'), ...fixtures(nodePath.join(FIXTURES, 'yarle'), '.enex')];

test('there are fixtures to convert', () => {
	assert.ok(enexFiles.length > 0, 'expected at least one .enex in tests/evernote');
});

for (const fixture of enexFiles) {
	test(`converts ${fixture.name}`, async () => {
		const expectedDir = expectedFor(fixture, nodePath.basename(fixture.name, '.enex'));

		await convert([fixture.path], (outputDir, ctx) => {
			assert.deepEqual(ctx.failures, [], 'no note should fail to convert');
			expectTree(notebookDir(outputDir), expectedDir, fixture.name);
		});
	});
}

test('resolves a link into another notebook', async () => {
	await convert(['test-internotebook_links_A.enex', 'test-internotebook_links_B.enex'].map(n => nodePath.join(FIXTURES, n)), outputDir => {
		const note = readTree(outputDir).get('test-internotebook_links_B/Note in Notebook B.md');

		assert.ok(note, 'note should exist');
		assert.match(note.toString('utf8'), /\[\[test-internotebook_links_A\/Note in Notebook A\|Note in Notebook A\]\]/);
	});
});

/**
 * resource-attributes holding a single child used to arrive as that child's
 * value rather than an object, which lost the name and wrote the attachment
 * as "unknown_filename". Nothing collapses an element now, but the case is
 * named here so a regression says what broke.
 */
/**
 * A table of contents in one notebook listing a note in another.
 *
 * An ENEX gives nothing a link can be resolved by: the href carries the target
 * note's Evernote guid, and no note in an export says what its own guid is. So
 * a link is matched to a note by the text Evernote wrote it with, which is the
 * target's title - and the note it finds is what says which folder the link
 * has to point into. Reading the notebook off the note the link was *in*, as
 * this used to, names the wrong one whenever the two differ.
 */
test('a link into another notebook names the notebook the note is in', async () => {
	await convert([
		nodePath.join(FIXTURES, 'toc-pointing-elsewhere_A.enex'),
		nodePath.join(FIXTURES, 'toc-pointing-elsewhere_B.enex'),
	], outputDir => {
		const toc = readTree(outputDir).get('toc-pointing-elsewhere_A/Table of Contents.md');

		assert.ok(toc, 'the table of contents should exist');
		// Named as well as pointed at, so the note reads "Shared Note" rather
		// than the folder it had to go through to find it.
		assert.equal(toc.toString('utf8').trim(), '[[toc-pointing-elsewhere_B/Shared Note|Shared Note]]');
	});
});

test('keeps a resource file name that is its only attribute', async () => {
	await convert([nodePath.join(FIXTURES, 'test-resource-attributes-single-child.enex')], outputDir => {
		const attachments = [...readTree(outputDir).keys()].filter(path => path.endsWith('.png'));

		assert.equal(attachments.length, 2);
		for (const path of attachments) {
			// Both notes call theirs dot.png, and they now share a folder, so
			// the second is numbered - but neither falls back to unknown_filename.
			assert.match(path, /\/dot( \d+)?\.png$/, `expected dot.png, got ${path}`);
		}
	});
});
