/**
 * The Evernote conversion, end to end, outside Obsidian.
 *
 * yarle reads .enex and writes markdown through the node modules that
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
import { defaultYarleOptions, dropTheRope } from '../../src/formats/yarle/yarle';

// Before any conversion runs. yarle reads these when it works, not when it
// loads, so the static imports above are fine.
provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// tsx runs these as CommonJS, so __dirname rather than import.meta.
const FIXTURES = __dirname;
const EXPECTED = nodePath.join(FIXTURES, 'expected');

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

/** Every file under a directory, by path relative to it, in path order. */
function readTree(dir: string): Map<string, Buffer> {
	const files = new Map<string, Buffer>();

	const walk = (current: string) => {
		for (const entry of nodeFs.readdirSync(current, { withFileTypes: true })) {
			const full = nodePath.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else files.set(nodePath.relative(dir, full).split(nodePath.sep).join('/'), nodeFs.readFileSync(full));
		}
	};
	walk(dir);

	return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

function copyTree(from: string, to: string): void {
	nodeFs.mkdirSync(nodePath.dirname(to), { recursive: true });
	nodeFs.cpSync(from, to, { recursive: true });
}

/**
 * Report how two trees differ, as lines, or nothing when they match.
 *
 * Content differences show both sides for anything that reads as text, since
 * that is the case worth eyeballing; binaries just report their sizes.
 */
function diffTrees(actual: Map<string, Buffer>, expected: Map<string, Buffer>): string[] {
	const problems: string[] = [];

	for (const path of expected.keys()) {
		if (!actual.has(path)) problems.push(`missing: ${path}`);
	}
	for (const path of actual.keys()) {
		if (!expected.has(path)) problems.push(`unexpected: ${path}`);
	}

	for (const [path, actualBytes] of actual) {
		const expectedBytes = expected.get(path);
		if (!expectedBytes || actualBytes.equals(expectedBytes)) continue;

		if (path.endsWith('.md') || path.endsWith('.base') || path.endsWith('.txt')) {
			problems.push(
				`differs: ${path}`,
				`  expected: ${JSON.stringify(expectedBytes.toString('utf8'))}`,
				`  actual:   ${JSON.stringify(actualBytes.toString('utf8'))}`,
			);
		}
		else {
			problems.push(`differs: ${path} (${expectedBytes.length} bytes expected, ${actualBytes.length} actual)`);
		}
	}

	return problems;
}

/** Convert the named fixtures into a temp directory, and hand it to the caller. */
async function convert<T>(fixtures: string[], use: (outputDir: string, ctx: ReturnType<typeof stubContext>) => T): Promise<T> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-'));
	const ctx = stubContext();

	try {
		await dropTheRope({
			...defaultYarleOptions,
			enexSources: fixtures.map(name => new NodePickedFile(nodePath.join(FIXTURES, name))),
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

const fixtures = nodeFs.readdirSync(FIXTURES).filter(name => name.endsWith('.enex')).sort();

test('there are fixtures to convert', () => {
	assert.ok(fixtures.length > 0, 'expected at least one .enex in tests/evernote');
});

for (const fixture of fixtures) {
	test(`converts ${fixture}`, async () => {
		const expectedDir = nodePath.join(EXPECTED, nodePath.basename(fixture, '.enex'));

		await convert([fixture], (outputDir, ctx) => {
			assert.deepEqual(ctx.failures, [], 'no note should fail to convert');
			const produced = notebookDir(outputDir);

			if (!nodeFs.existsSync(expectedDir)) {
				copyTree(produced, expectedDir);
				console.log(`Recorded a baseline for ${fixture} - review tests/evernote/expected/${nodePath.basename(expectedDir)}/`);
				return;
			}

			const problems = diffTrees(readTree(produced), readTree(expectedDir));
			assert.deepEqual(problems, [], `output differs from tests/evernote/expected/${nodePath.basename(expectedDir)}/\n${problems.join('\n')}`);
		});
	});
}

/**
 * Links across notebooks only resolve when both are imported together, so this
 * one cannot be a per-fixture recording.
 */
test('resolves a link into another notebook', async () => {
	await convert(['test-internotebook_links_A.enex', 'test-internotebook_links_B.enex'], outputDir => {
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
	await convert(['test-resource-attributes-single-child.enex'], outputDir => {
		const attachments = [...readTree(outputDir).keys()].filter(path => path.endsWith('.png'));

		assert.equal(attachments.length, 2);
		for (const path of attachments) {
			assert.ok(path.endsWith('/dot.png'), `expected dot.png, got ${path}`);
		}
	});
});
