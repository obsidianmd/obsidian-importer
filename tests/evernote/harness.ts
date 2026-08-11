/**
 * What every Evernote test needs to run an import and look at the result.
 *
 * The four test files each had their own copy of the context stub, the
 * temporary directory dance and the list of files written; this is that, once.
 */
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { convertEnexFiles } from '../../src/formats/evernote/convert';
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { readTree } from '../helpers';
import { FsOutput, FsOutputOptions } from './fs-output';

provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

/** Stands in for ImportContext, remembering what it was told. */
export function stubContext() {
	return {
		notes: [] as string[],
		skips: [] as string[],
		failures: [] as string[],
		attachments: [] as string[],
		statuses: 0,
		status() { this.statuses++; },
		reportNoteSuccess(name: string) { this.notes.push(name); },
		reportAttachmentSuccess(name: string) { this.attachments.push(name); },
		reportSkipped(name: string) { this.skips.push(String(name)); },
		reportFailed(name: string, reason?: unknown) { this.failures.push(`${String(name)}: ${String(reason)}`); },
		reportProgress() { },
		isCancelled() { return false; },
		async shouldStop() { return this.isCancelled(); },
		cancel() { },
		finish() { },
	};
}

export type Context = ReturnType<typeof stubContext>;

/** Run an import of these enex files into this directory. */
export async function importEnex(
	outputDir: string,
	fixtures: string[],
	{ ctx = stubContext(), ...output }: FsOutputOptions & { ctx?: Context } = {},
): Promise<Context> {
	await convertEnexFiles({
		...defaultEvernoteOptions,
		enexSources: fixtures.map(path => new NodePickedFile(path)),
		outputDir,
	}, new FsOutput(outputDir, { ...output, ctx }), ctx as never);

	return ctx;
}

/** A temporary output folder, taken down whether or not the test passes. */
export async function inTempDir(use: (outputDir: string) => Promise<void> | void): Promise<void> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-'));

	try {
		await use(outputDir);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

/**
 * Every file written, as the vault-style relative paths a test asserts on.
 *
 * Sorted by code point rather than readTree's locale order, so an expected
 * list can be written down and `.sort()`ed the way any other array would be.
 */
export function tree(dir: string): string[] {
	return [...readTree(dir).keys()].sort();
}

/** The one folder an import of a single notebook writes into. */
export function notebookDir(outputDir: string): string {
	const folders = nodeFs.readdirSync(outputDir, { withFileTypes: true }).filter(entry => entry.isDirectory());

	assert.equal(folders.length, 1, `expected one notebook folder, got: ${folders.map(f => f.name).join(', ') || 'none'}`);

	return nodePath.join(outputDir, folders[0].name);
}
