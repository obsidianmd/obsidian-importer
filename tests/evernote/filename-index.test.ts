/**
 * Which name the Evernote importer picks when one is already taken.
 *
 * yarle writes a note with a plain writeFileSync, so getFileIndex is the only
 * thing standing between two notes and a lost one: the index it returns is
 * used as it comes. #568 fixed two ways it could hand back a name already on
 * disk - a title differing only in case, and a gap in the numbering - and
 * these are the folders that produced them.
 *
 * filename-dedupe.test.ts covers the picking itself, on lists of names. This
 * covers the seam: a real folder, read through src/filesystem, which is what
 * the importer actually calls.
 *
 * What is asserted is the name chosen, not what a filesystem then does with
 * it. The case bug only destroys a note where the volume folds case, and a
 * test that imported and counted files would pass on a case-sensitive one
 * while the bug was still there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { provideNodeModules } from '../../src/filesystem';
import { getFileIndex } from '../../src/formats/yarle/utils/filename-utils';

// yarle reads these when it works rather than when it loads, so the static
// import above is fine.
provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

/** getFileIndex against a folder holding exactly these files. */
function indexFor(existing: string[], prefix: string): number {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		for (const file of existing) nodeFs.writeFileSync(nodePath.join(dir, file), '');
		return getFileIndex(dir, prefix);
	}
	finally {
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
}

/** The note file that index turns into, the way getNoteName spells it. */
function nameFor(existing: string[], prefix: string): string {
	const index = indexFor(existing, prefix);
	return `${index === 0 ? prefix : `${prefix}.${index}`}.md`;
}

/** What a default macOS or Windows volume would call the same file. */
function alreadyThere(existing: string[], candidate: string): boolean {
	return existing.some(file => file.toLowerCase() === candidate.toLowerCase());
}

test('a title differing only in case does not take the other one', () => {
	const existing = ['Sales.md'];

	assert.equal(nameFor(existing, 'sales'), 'sales.1.md');
	assert.ok(!alreadyThere(existing, nameFor(existing, 'sales')));
});

test('a gap in the numbering is filled rather than landed on', () => {
	// Reachable by importing, deleting the middle note, and importing again.
	// Counting the matches rather than looking for a free number returned 2
	// here, which is the note that is already there.
	const existing = ['sales.md', 'sales.2.md'];

	assert.equal(nameFor(existing, 'sales'), 'sales.1.md');
	assert.ok(!alreadyThere(existing, nameFor(existing, 'sales')));
});

test('a note whose title merely ends with another does not push its numbering', () => {
	// The prefix has to match from the start: 'Q3 sales.1' is not a copy of
	// 'sales', so 'sales' is still free.
	assert.equal(nameFor(['Q3 sales.1.md'], 'sales'), 'sales.md');
});

test('a numbered copy is recognised through the zettelkasten title', () => {
	// getNoteName writes these as `<id>.<n> <title>`, so the number is
	// followed by a space rather than by the extension.
	assert.equal(indexFor(['202601011230.md', '202601011230.1 Project.md'], '202601011230'), 2);
});

test('an empty folder leaves the title alone', () => {
	assert.equal(nameFor([], 'sales'), 'sales.md');
});
