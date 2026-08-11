/**
 * What the numbers on the progress screen mean.
 *
 * "Imported" and "remaining" answer different questions, and were once written
 * from the same number: an importer reports how far it has got, counting the
 * items it skipped and the ones that failed, and that count was being drawn as
 * the number of notes imported. An import where nothing landed read as though
 * everything had.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImportProgressUI } from '../../src/main';

interface Stats {
	imported: string;
	remaining: string;
	skipped: string;
	failed: string;
}

function statsOf(ui: ImportProgressUI): Stats {
	return {
		imported: ui.importedCountEl.textContent ?? '',
		remaining: ui.remainingCountEl.textContent ?? '',
		skipped: ui.skippedCountEl.textContent ?? '',
		failed: ui.failedCountEl.textContent ?? '',
	};
}

function drawn(): ImportProgressUI {
	return new ImportProgressUI(document.body.createDiv());
}

test('an import of thirty where ten landed says ten landed', () => {
	const ui = drawn();

	for (let n = 0; n < 30; n++) {
		if (n % 3 === 0) ui.reportNoteSuccess(`note ${n}`);
		else if (n % 3 === 1) ui.reportSkipped(`note ${n}`, 'it is already in the vault');
		else ui.reportFailed(`note ${n}`, 'HTTP 502');

		ui.reportProgress(n + 1, 30);
	}

	assert.deepEqual(statsOf(ui), { imported: '10', remaining: '0', skipped: '10', failed: '10' });
});

test('progress reported after a note landed does not overwrite what landed', () => {
	const ui = drawn();

	ui.reportNoteSuccess('the only note that landed');
	ui.reportProgress(9, 10);

	assert.equal(statsOf(ui).imported, '1');
	assert.equal(statsOf(ui).remaining, '1');
});

test('an import that reports no progress still counts what it imported', () => {
	const ui = drawn();

	ui.reportNoteSuccess('a note');
	ui.reportNoteSuccess('another');

	assert.equal(statsOf(ui).imported, '2');
});
