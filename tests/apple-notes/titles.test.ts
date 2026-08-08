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

		const body = String(run.vault.contents.get(file.path));
		assert.ok(body.contains(URL), `the URL was lost; the note holds ${JSON.stringify(body)}`);
	}
	finally {
		run.close();
	}
});
