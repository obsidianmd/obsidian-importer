import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImportProgressUI } from '../../src/progress-ui';

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

test('a count of thousands is grouped the way the reader groups one', () => {
	const ui = drawn();

	ui.reportProgress(2500, 14000);
	for (let note = 0; note < 12345; note++) ui.reportNoteSuccess(`Note ${note}`);

	assert.equal(statsOf(ui).imported, '12,345');
	assert.equal(statsOf(ui).remaining, '11,500');
});
