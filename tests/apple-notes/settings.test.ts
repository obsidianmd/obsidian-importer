/**
 * Settings the importer reads from the vault rather than asking for. The
 * conversion tests hand the converter a context of their own, so they cannot
 * tell whether the importer fills it in from the right place.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { importing } from './importing';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

/** What Shift-Return puts in the text: a line separator, not a paragraph end. */
const SOFT_RETURN = '\u2028';

const NOTE = [{
	title: 'Soft returns',
	runs: [{ text: `Soft returns\nA paragraph${SOFT_RETURN}broken by a soft return.` }],
}];

/** Off, which is the default: a newline already renders as the break. */
test('a soft return is a bare newline when the vault leaves strict line breaks off', async () => {
	const run = await importing(NOTE, DuplicateHandling.CreateCopy);

	try {
		const file = await run.resolve(run.notePks[0]);
		const body = String(run.vault.contents.get(file!.path));

		assert.ok(body.contains('A paragraph\nbroken'), `got ${JSON.stringify(body)}`);
	}
	finally {
		run.close();
	}
});

/** On: a lone newline is no longer a break, so it is spelled out. */
test('a soft return is spelled out when the vault has strict line breaks on', async () => {
	const run = await importing(NOTE, DuplicateHandling.CreateCopy);
	run.vault.config.set('strictLineBreaks', true);

	try {
		const file = await run.resolve(run.notePks[0]);
		const body = String(run.vault.contents.get(file!.path));

		assert.ok(body.contains('A paragraph  \nbroken'), `got ${JSON.stringify(body)}`);
	}
	finally {
		run.close();
	}
});
