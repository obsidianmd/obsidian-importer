import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImportContext } from '../../src/import-context';
import { FormatImporter } from '../../src/format-importer';
import { ImporterFlow, ImporterShell } from '../../src/importer-flow';
import type ImporterPlugin from '../../src/main';

class TestShell implements ImporterShell {
	readonly containerEl = document.body.createDiv();
	readonly contentEl = this.containerEl.createDiv();
	readonly ownsBackButton = true;
	readonly ownsFocus = false;

	finished = 0;

	setScreen(): void {
	}

	setPickingFormat(): void {
	}

	adoptButtonBar(): void {
	}

	finish(): void {
		this.finished++;
	}

	foreground(): void {
	}
}

interface FlowInternals {
	drawCurrent: () => unknown;
	depth: number;
	startImportRun(importer: FormatImporter): Promise<void>;
	setUpImporter(): void;
	showFirstStep(): void;
	finish(): void;
}

function flow(): { flow: ImporterFlow, shell: TestShell } {
	const shell = new TestShell();
	const plugin = {
		importers: {
			csv: { importer: class {} },
		},
	} as unknown as ImporterPlugin;

	return {
		flow: new ImporterFlow({} as never, plugin, shell),
		shell,
	};
}

test('back resolves a configuration screen that is waiting for its own buttons', async () => {
	const { flow: importerFlow } = flow();
	const internals = importerFlow as unknown as FlowInternals;
	let returnedToSetup = 0;

	importerFlow.selectedId = 'csv';
	internals.depth = 2;
	internals.drawCurrent = () => returnedToSetup++;

	const importer = {
		showTemplateConfiguration: () => new Promise<boolean>(() => {}),
	} as unknown as FormatImporter;

	const starting = internals.startImportRun(importer);
	await Promise.resolve();

	importerFlow.back();
	await starting;

	assert.equal(returnedToSetup, 1);
	assert.equal(importerFlow.current, null);
});

test('selecting the running format creates another importer', () => {
	const { flow: importerFlow } = flow();
	const internals = importerFlow as unknown as FlowInternals;
	let created = 0;
	let reused = 0;

	importerFlow.selectedId = 'csv';
	importerFlow.importer = {} as FormatImporter;
	importerFlow.current = new ImportContext();
	internals.setUpImporter = () => created++;
	internals.showFirstStep = () => reused++;

	importerFlow.selectFormat('csv');

	assert.equal(created, 1);
	assert.equal(reused, 0);
});

test('Done resets the next opening to the format list', () => {
	const { flow: importerFlow, shell } = flow();
	const internals = importerFlow as unknown as FlowInternals;
	let drewFormatList = 0;

	importerFlow.selectedId = 'csv';
	importerFlow.showFormatPicker = () => {
		drewFormatList++;
	};

	internals.finish();

	assert.equal(importerFlow.selectedId, '');
	assert.equal(drewFormatList, 1);
	assert.equal(shell.finished, 1);
});
