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

test('a link into another notebook names the notebook the note is in', async () => {
	await convert([
		nodePath.join(FIXTURES, 'toc-pointing-elsewhere_A.enex'),
		nodePath.join(FIXTURES, 'toc-pointing-elsewhere_B.enex'),
	], outputDir => {
		const toc = readTree(outputDir).get('toc-pointing-elsewhere_A/Table of Contents.md');

		assert.ok(toc, 'the table of contents should exist');
		assert.equal(toc.toString('utf8').trim(), '[[toc-pointing-elsewhere_B/Shared Note|Shared Note]]');
	});
});

test('counts the links no note answered to', async () => {
	await convert([nodePath.join(FIXTURES, 'note-link-to-a-renamed-note.enex')], (_outputDir, ctx) => {
		assert.equal(ctx.messages.length, 1);
		assert.match(ctx.messages[0], /^1 link could not be matched to a note\./);
		assert.deepEqual([ctx.skips, ctx.failures], [[], []]);
	});
});

test('says nothing when every link found its note', async () => {
	await convert([nodePath.join(FIXTURES, 'note-link-without-title.enex')], (_outputDir, ctx) => {
		assert.deepEqual(ctx.messages, []);
	});
});

test('keeps a resource file name that is its only attribute', async () => {
	await convert([nodePath.join(FIXTURES, 'test-resource-attributes-single-child.enex')], outputDir => {
		const attachments = [...readTree(outputDir).keys()].filter(path => path.endsWith('.png'));

		assert.equal(attachments.length, 2);
		for (const path of attachments) {
			assert.match(path, /\/dot( \d+)?\.png$/, `expected dot.png, got ${path}`);
		}
	});
});
