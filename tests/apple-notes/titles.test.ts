import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { noteTitle } from '../../src/formats/apple-notes/convert-note';
import { sanitizeFileName } from '../../src/util';
import { importing } from './importing';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

/** An attachment stands in the note text as one character. */
const ATTACHMENT = '\uFFFC';
const SOFT_RETURN = '\u2028';

/**
 * Apple looks past a line holding nothing but an attachment: a note opening
 * with a photo is titled from the text under it. Naming it after that
 * character instead put every such note at the same name.
 */
test('a note opening with an attachment is named after its text', () => {
	assert.equal(noteTitle(`${ATTACHMENT}\nPhotos from Rome`, 'Photos from Rome'), 'Photos from Rome');
	assert.equal(noteTitle(`${ATTACHMENT}${ATTACHMENT}\n\nRome`, 'Rome'), 'Rome');
	assert.equal(noteTitle(`${ATTACHMENT}Photos from Rome\nMore`, 'x'), 'Photos from Rome');

	// Nothing but attachments, so there is no text to name it after
	assert.equal(noteTitle(`${ATTACHMENT}\n${ATTACHMENT}`, 'Photos from Rome'), 'Photos from Rome');
});

/**
 * A soft return is part of the line Apple titles a note with - ZTITLE1 carries
 * one - but a line separator in a file name is invisible.
 */
test('a soft return in the first line does not reach the file name', () => {
	const title = noteTitle(`Sennheiser 416${SOFT_RETURN}Deity - S-Mic 2S\nBody`, 'x');

	assert.equal(title, 'Sennheiser 416 Deity - S-Mic 2S');
	assert.doesNotMatch(sanitizeFileName(title), /[\u2028\u2029]/);
});

test('a Markdown list marker stays in the body but not in the note title', async () => {
	const run = await importing(
		[{
			title: '- why meetup',
			runs: [
				{ text: '- why meetup\n' },
				{ text: '- what comes in the box' },
			],
		}],
		DuplicateHandling.CreateCopy,
	);

	try {
		run.subject.omitFirstLine = false;
		const file = await run.resolve(run.notePks[0]);

		assert.equal(file?.path, 'why meetup.md');
		assert.match(String(run.vault.contents.get(file!.path)), /- why meetup/);
	}
	finally {
		run.close();
	}
});

/**
 * A vault an older importer wrote holds the note under the abbreviated title it
 * used. Recognising a note is by path, so naming it from the first line now
 * looks somewhere the old file is not, and the note is imported twice.
 */
test('a note an older import named after ZTITLE1 is still recognised', async () => {
	const run = await importing(
		[{
			title: ABBREVIATED,
			runs: [{ text: `${LONG_LINE}\n` }, { text: 'And the rest of the note.' }],
		}],
		DuplicateHandling.Skip
	);

	try {
		// What the previous importer left behind
		await run.vault.create(`${ABBREVIATED}.md`, 'The note as it was imported before.');

		await run.resolve(run.notePks[0]);

		assert.deepEqual(run.vault.paths(), [`${ABBREVIATED}.md`], 'the note was imported a second time');
		assert.equal(run.skipped.length, 1, 'it should have been recognised as already imported');
	}
	finally {
		run.close();
	}
});

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

test('a note title can combine Apple Notes variables with Knap filters', async () => {
	const run = await importing(
		[{ title: 'Planning', runs: [{ text: 'Planning\n' }, { text: 'The details.' }] }],
		DuplicateHandling.CreateCopy,
	);

	try {
		run.subject.noteTitleTemplate = '{{ctime | date:"YYYY-MM-DD"}} {{title | upper}}';
		const file = await run.resolve(run.notePks[0]);

		assert.ok(file);
		assert.match(file.path, /^\d{4}-\d{2}-\d{2} PLANNING\.md$/);
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
