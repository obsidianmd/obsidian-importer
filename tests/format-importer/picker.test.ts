import '../shims/dom';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Platform } from 'obsidian';
import { FormatImporter } from '../../src/format-importer';
import { LogseqImporter } from '../../src/formats/logseq';
import { MemoryVault, memoryApp } from '../shims/vault';

class LogseqSourcePicker extends LogseqImporter {
	protected override stepEl(step: string): HTMLElement | null {
		return step === 'source' ? super.stepEl('source') : null;
	}

	protected override draw<T>(): T | undefined {
		return undefined;
	}
}

class MultipleSourcePicker extends FormatImporter {
	init(): void {
		this.addFileChooserSetting('Markdown', ['md'], true);
	}

	async import(): Promise<void> {}
}

test('Logseq only offers a single folder in the desktop source picker', async t => {
	const previousDesktop = Platform.isDesktopApp;
	const previousElectron = window.electron;
	t.after(() => {
		Object.assign(Platform, { isDesktopApp: previousDesktop });
		window.electron = previousElectron;
	});
	Object.assign(Platform, { isDesktopApp: true });

	const properties: string[][] = [];
	window.electron = { remote: { dialog: {
		showOpenDialogSync(options: { properties: string[] }) {
			properties.push(options.properties);
			return undefined;
		},
	} } } as typeof window.electron;

	for (const Importer of [LogseqSourcePicker, MultipleSourcePicker]) {
		const sourceEl = document.body.createDiv();
		t.after(() => sourceEl.remove());
		const importer = new Importer(memoryApp(new MemoryVault()), {
			sourceEl, outputEl: null, optionsEl: null,
			abortController: new AbortController(),
		} as never);
		await importer.ready;

		const rows = Array.from(sourceEl.querySelectorAll<HTMLElement>('.mod-add-item'));
		const folders = rows.find(row => row.textContent === 'Choose folders');
		assert.ok(folders);
		assert.equal(rows.some(row => row.textContent === 'Choose files'), Importer === MultipleSourcePicker);
		folders.click();
	}

	assert.deepEqual(properties, [
		['openDirectory', 'dontAddToRecent'],
		['openDirectory', 'dontAddToRecent', 'multiSelections'],
	]);
});
