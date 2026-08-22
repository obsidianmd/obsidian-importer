import '../shims/dom';
import '../shims/runtime';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Setting } from 'obsidian';

import { NoteTemplateSetup } from '../../src/format-importer';
import { CSVImporter } from '../../src/formats/csv';
import { ImportContext } from '../../src/import-context';
import { memoryApp, MemoryVault } from '../shims/vault';

class ConfiguringCSV extends CSVImporter {
	setup!: NoteTemplateSetup;
	previewChanges = 0;

	protected override async showNoteTemplateConfiguration(
		container: HTMLElement,
		_buttonsEl: HTMLElement,
		setup: NoteTemplateSetup,
	): Promise<boolean> {
		this.setup = setup;
		setup.configure?.(container, () => this.previewChanges++);
		return true;
	}
}

test('note title and location are configured on the CSV template page', async () => {
	const settingPrototype = Setting.prototype as unknown as Record<string, unknown>;
	const realAddText = settingPrototype.addText;
	settingPrototype.addText = function(callback: (component: unknown) => void) {
		const setting = this as unknown as Setting;
		const inputEl = setting.controlEl.createEl('input', { type: 'text' });
		const component = {
			inputEl,
			setPlaceholder(value: string) { inputEl.placeholder = value; return this; },
			setValue(value: string) { inputEl.value = value; return this; },
			onChange(change: (value: string) => void) {
				inputEl.addEventListener('input', () => change(inputEl.value));
				return this;
			},
		};
		callback(component);
		return this;
	};

	try {
		const subject = new ConfiguringCSV(memoryApp(new MemoryVault()), {
			sourceEl: null,
			outputEl: null,
			optionsEl: null,
			plugin: null,
			importerId: 'csv',
			abortController: new AbortController(),
		} as never);
		await subject.ready;
		subject.files = [{
			name: 'sample.csv',
			readText: async () => 'Name,Category\nAlpha,Work\n',
		} as never];

		const container = createDiv();
		assert.equal(
			await subject.showTemplateConfiguration(new ImportContext(), container, createDiv()),
			true,
		);

		const names = Array.from(container.querySelectorAll('.setting-item-name'))
			.map(element => element.textContent);
		assert.deepEqual(names, ['Note title', 'Note location']);

		const inputs = Array.from(container.querySelectorAll('input'));
		assert.equal(inputs[0].value, '{{Name}}');
		assert.equal(inputs[1].value, '');

		inputs[0].value = '{{Name | upper}}';
		inputs[0].dispatchEvent(new window.Event('input'));
		inputs[1].value = 'groups/{{Category | lower}}';
		inputs[1].dispatchEvent(new window.Event('input'));
		assert.equal(subject.previewChanges, 2);

		const rendered = await subject.setup.preview!('{{content}}');
		const previews = Array.isArray(rendered) ? rendered : [rendered];
		assert.equal(previews[0].path, 'CSV import/groups/work/ALPHA.md');
	}
	finally {
		settingPrototype.addText = realAddText;
	}
});
