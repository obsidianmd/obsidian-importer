/**
 * What an imported note is named.
 *
 * Apple shows a note's first line as its title, but ZTITLE1 holds only an
 * abbreviation of it: past about eighty characters it is cut short and an
 * ellipsis put in place of the rest (#541). The line itself is in the note
 * text, and is what the note should be named after.
 *
 * A first line that is a URL cannot survive as a file name - a slash is a path
 * separator and a colon is not allowed - so naming the note after it and then
 * dropping it from the body loses the URL altogether (#591). It stays.
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

/** A first line long enough that Apple stores an abbreviation of it. */
const LONG_LINE = 'The reason we moved buttons to the bottom is to improve accessibility for one-handed use';
const ABBREVIATED = 'The reason we moved buttons to the bottom is to improve accessibility…';

test('a note is named after its first line, not the abbreviation Apple stores', async () => {
	const run = await importing(
		[{
			title: ABBREVIATED,
			runs: [{ text: `${LONG_LINE}\n` }, { text: 'And the rest of the note.' }],
		}],
		DuplicateHandling.CreateCopy
	);

	try {
		const file = await run.resolve(run.notePks[0]);

		assert.ok(file, 'the note should be imported');
		assert.doesNotMatch(file.path, /…/, 'the name was cut short with an ellipsis');
		assert.deepEqual(run.vault.paths(), [`${LONG_LINE}.md`]);
	}
	finally {
		run.close();
	}
});

const URL = 'https://en.wikipedia.org/wiki/Jhumpa_Lahiri';

test('a first line that is a URL is kept in the note', async () => {
	const run = await importing(
		[{ title: URL, runs: [{ text: `${URL}\n` }, { text: 'A writer.' }] }],
		DuplicateHandling.CreateCopy
	);

	try {
		const file = await run.resolve(run.notePks[0]);

		assert.ok(file, 'the note should be imported');

		// The file name cannot hold it - that is the reason it has to stay in
		// the body, where it is still a URL that works
		const body = String(run.vault.contents.get(file.path));
		assert.ok(body.contains(URL), `the URL was lost; the note holds ${JSON.stringify(body)}`);
	}
	finally {
		run.close();
	}
});
