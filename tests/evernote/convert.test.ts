/**
 * The Evernote conversion, end to end, outside Obsidian.
 *
 * yarle reads .enex and writes markdown through the node modules that
 * filesystem.ts hands out, and never touches the vault, so the whole pipeline
 * runs here once those modules are supplied.
 *
 * Every .enex in this directory is converted and compared against a recorded
 * result in expected/. Adding a fixture is: drop the file in, run the tests,
 * review the expected/ file it writes. Changing one on purpose is: delete its
 * expected/ file, run the tests, read the diff.
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
import { defaultYarleOptions, dropTheRope } from '../../src/formats/yarle/yarle';

// Before any conversion runs. yarle reads these when it works, not when it
// loads, so the static imports above are fine.
provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// tsx runs these as CommonJS, so __dirname rather than import.meta.
const FIXTURES = __dirname;
const EXPECTED = nodePath.join(FIXTURES, 'expected');

/** Recorded in full; anything else is recorded as a size. */
const TEXT = new Set(['.md', '.txt', '.csv', '.json']);

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
		cancel() { },
		hideStatus() { },
	};
}

/** Convert the named fixtures into a temp directory and read back everything written. */
async function convert(...fixtures: string[]) {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-'));
	const ctx = stubContext();

	try {
		await dropTheRope({
			...defaultYarleOptions,
			enexSources: fixtures.map(name => new NodePickedFile(nodePath.join(FIXTURES, name))),
			outputDir,
		}, ctx as never);

		const files: Record<string, string | number> = {};
		const walk = (dir: string) => {
			for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
				const full = nodePath.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				const rel = nodePath.relative(outputDir, full).split(nodePath.sep).join('/');
				files[rel] = TEXT.has(nodePath.extname(rel))
					? nodeFs.readFileSync(full, 'utf8')
					: nodeFs.statSync(full).size;
			}
		};
		walk(outputDir);
		return { files, ctx };
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

/**
 * The whole conversion as one reviewable document: what was reported, then
 * every file in path order. Binary files show their size rather than bytes.
 */
function record(files: Record<string, string | number>, ctx: ReturnType<typeof stubContext>): string {
	const summary = { notes: ctx.notes.length, skipped: ctx.skips, failed: ctx.failures };
	const parts = ['```json', JSON.stringify(summary, null, 2), '```', ''];

	for (const path of Object.keys(files).sort()) {
		const contents = files[path];
		parts.push(`## ${path}`);
		parts.push(typeof contents === 'number' ? `<${contents} bytes>` : '```\n' + contents + '\n```');
		parts.push('');
	}

	return parts.join('\n');
}

const fixtures = nodeFs.readdirSync(FIXTURES).filter(name => name.endsWith('.enex')).sort();

test('there are fixtures to convert', () => {
	assert.ok(fixtures.length > 0, 'expected at least one .enex in tests/evernote');
});

for (const fixture of fixtures) {
	test(`converts ${fixture}`, async () => {
		const { files, ctx } = await convert(fixture);
		const actual = record(files, ctx);
		const expectedPath = nodePath.join(EXPECTED, `${nodePath.basename(fixture, '.enex')}.md`);

		assert.deepEqual(ctx.failures, [], 'no note should fail to convert');

		if (!nodeFs.existsSync(expectedPath)) {
			nodeFs.mkdirSync(EXPECTED, { recursive: true });
			nodeFs.writeFileSync(expectedPath, actual);
			console.log(`Recorded a baseline for ${fixture} - review tests/evernote/expected/${nodePath.basename(expectedPath)}`);
			return;
		}

		assert.equal(actual.trim(), nodeFs.readFileSync(expectedPath, 'utf8').trim());
	});
}

/**
 * Links across notebooks only resolve when both are imported together, so this
 * one cannot be a per-fixture recording.
 */
test('resolves a link into another notebook', async () => {
	const { files } = await convert('test-internotebook_links_A.enex', 'test-internotebook_links_B.enex');
	const note = files['test-internotebook_links_B/Note in Notebook B.md'];

	assert.equal(typeof note, 'string');
	assert.match(note as string, /\[\[test-internotebook_links_A\/Note in Notebook A\]\]/);
});

/**
 * xml-flow hands back the child's value rather than an object when
 * resource-attributes holds a single child, which used to lose the name and
 * write the attachment as "unknown_filename". The recording above covers it
 * too, but named here so a regression says what broke.
 */
test('keeps a resource file name that is its only attribute', async () => {
	const { files } = await convert('test-resource-attributes-single-child.enex');
	const attachments = Object.keys(files).filter(path => path.endsWith('.png'));

	assert.equal(attachments.length, 2);
	for (const path of attachments) {
		assert.ok(path.endsWith('/dot.png'), `expected dot.png, got ${path}`);
	}
});
