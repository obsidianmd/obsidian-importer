/**
 * The Evernote conversion, end to end, outside Obsidian.
 *
 * The conversion reads .enex and writes markdown through the node modules that
 * filesystem.ts hands out, and never touches the vault, so the whole pipeline
 * runs here once those modules are supplied.
 *
 * Every .enex in this directory is converted and the files it produces are
 * compared against expected/<fixture>/ - the real output tree, note for note
 * and attachment for attachment. It is what a user would end up with, so it
 * can be read directly, or opened in Obsidian, rather than decoded from a
 * recording.
 *
 * Adding a fixture is: drop the .enex in, run the tests, review the tree that
 * appears. Changing one on purpose is: delete its expected/ directory, run the
 * tests, read the diff.
 *
 * This is a regression check rather than a fidelity one: Obsidian bundles its
 * own turndown build, so the markdown here can in principle differ from what
 * ships. On these fixtures it does not - the recorded output matches what the
 * app produces byte for byte - but only running inside Obsidian settles that.
 * See tests/shims/dom.ts.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { expectedFor, expectTree, fixtures, readTree } from '../helpers';
import { defaultEvernoteOptions, convertEnexFiles } from '../../src/formats/evernote/convert';

// Before any conversion runs. These are read when it works, not when it
// loads, so the static imports above are fine.
provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// tsx runs these as CommonJS, so __dirname rather than import.meta.
const FIXTURES = __dirname;

/** Enough of ImportContext for the conversion path, plus what it recorded. */
function stubContext() {
	return {
		notes: [] as string[],
		failures: [] as string[],
		skips: [] as string[],
		status() { },
		reportNoteSuccess(name: string) { this.notes.push(name); },
		reportAttachmentSuccess() { },
		reportSkipped(name: string) { this.skips.push(String(name)); },
		reportFailed(name: string, reason?: unknown) { this.failures.push(`${String(name)}: ${String(reason)}`); },
		reportProgress() { },
		isCancelled() { return false; },
		async shouldStop() { return false; },
		cancel() { },
		hideStatus() { },
	};
}

/** Convert the named fixtures into a temp directory, and hand it to the caller. */
async function convert<T>(paths: string[], use: (outputDir: string, ctx: ReturnType<typeof stubContext>) => T): Promise<T> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-'));
	const ctx = stubContext();

	try {
		await convertEnexFiles({
			...defaultEvernoteOptions,
			enexSources: paths.map(path => new NodePickedFile(path)),
			outputDir,
		}, ctx as never);

		return use(outputDir, ctx);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

/**
 * One .enex becomes one notebook folder named after it. That folder is what
 * gets recorded, rather than the temp directory around it, so expected/ reads
 * as a vault would rather than repeating the fixture name twice.
 */
function notebookDir(outputDir: string): string {
	const folders = nodeFs.readdirSync(outputDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
	assert.equal(folders.length, 1, `expected one notebook folder, got: ${folders.map(f => f.name).join(', ') || 'none'}`);
	return nodePath.join(outputDir, folders[0].name);
}

const enexFiles = fixtures(FIXTURES, '.enex');

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

/**
 * Links across notebooks only resolve when both are imported together, so this
 * one cannot be a per-fixture recording.
 */
test('resolves a link into another notebook', async () => {
	await convert(['test-internotebook_links_A.enex', 'test-internotebook_links_B.enex'].map(n => nodePath.join(FIXTURES, n)), outputDir => {
		const note = readTree(outputDir).get('test-internotebook_links_B/Note in Notebook B.md');

		assert.ok(note, 'note should exist');
		assert.match(note.toString('utf8'), /\[\[test-internotebook_links_A\/Note in Notebook A\]\]/);
	});
});

/**
 * xml-flow hands back the child's value rather than an object when
 * resource-attributes holds a single child, which used to lose the name and
 * write the attachment as "unknown_filename". The tree above covers it too,
 * but named here so a regression says what broke.
 */
test('keeps a resource file name that is its only attribute', async () => {
	await convert([nodePath.join(FIXTURES, 'test-resource-attributes-single-child.enex')], outputDir => {
		const attachments = [...readTree(outputDir).keys()].filter(path => path.endsWith('.png'));

		assert.equal(attachments.length, 2);
		for (const path of attachments) {
			assert.ok(path.endsWith('/dot.png'), `expected dot.png, got ${path}`);
		}
	});
});
