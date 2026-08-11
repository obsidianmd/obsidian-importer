import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { expectedFor, expectTree, fixtures, readTree } from '../helpers';
import { convertEnexFiles } from '../../src/formats/evernote/convert';
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { FsOutput } from './fs-output';

provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// tsx runs these as CommonJS, so __dirname rather than import.meta.
const FIXTURES = __dirname;

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
		finish() { },
	};
}

async function convert<T>(paths: string[], use: (outputDir: string, ctx: ReturnType<typeof stubContext>) => T): Promise<T> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-'));
	const ctx = stubContext();

	try {
		await convertEnexFiles({
			...defaultEvernoteOptions,
			enexSources: paths.map(path => new NodePickedFile(path)),
			outputDir,
		}, new FsOutput(outputDir), ctx as never);

		return use(outputDir, ctx);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

function notebookDir(outputDir: string): string {
	const folders = nodeFs.readdirSync(outputDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
	assert.equal(folders.length, 1, `expected one notebook folder, got: ${folders.map(f => f.name).join(', ') || 'none'}`);
	return nodePath.join(outputDir, folders[0].name);
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
			// Both notes call theirs dot.png, and they now share a folder, so
			// the second is numbered - but neither falls back to unknown_filename.
			assert.match(path, /\/dot( \d+)?\.png$/, `expected dot.png, got ${path}`);
		}
	});
});
