import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FormatImporter, NoteTemplateSample, NoteTemplateSetup } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { memoryApp, MemoryVault } from '../shims/vault';
import { NoteTemplateConfigurator, propertyIcon } from '../../src/note-template-configurator';
import type { ManagedTemplateProperty } from '../../src/note-template-configurator';
import { Setting } from 'obsidian';

class LoadingPreviewImporter extends FormatImporter {
	configurationShown = false;
	preview!: Promise<unknown>;
	private releaseSamples!: (samples: NoteTemplateSample[]) => void;

	init(): void {}
	async import(): Promise<void> {}

	protected override templatePreviewSamples(): Promise<NoteTemplateSample[]> {
		return new Promise(resolve => { this.releaseSamples = resolve; });
	}

	protected override async showNoteTemplateConfiguration(
		_container: HTMLElement,
		_buttonsEl: HTMLElement,
		setup: NoteTemplateSetup,
	): Promise<boolean> {
		this.configurationShown = true;
		this.preview = setup.preview!('{{content}}');
		return true;
	}

	finishLoading(): void {
		this.releaseSamples([{
			title: 'Loaded note',
			path: 'Import/Loaded note.md',
			content: 'Loaded content',
		}]);
	}
}

class NoteSettingsImporter extends FormatImporter {
	init(): void {
		this.idProperty = 'source-id';
		this.startGroup('template');
		this.addSetting('template')?.setName('Cover property name');
		this.addSetting('template')?.setName('Database property name');
	}

	async import(): Promise<void> {}

	protected override managedTemplateProperties(): ManagedTemplateProperty[] {
		return [{ key: 'tags', value: '{{tags}}' }];
	}

	showSettings(container: HTMLElement, buttonsEl: HTMLElement): Promise<boolean> {
		return this.showNoteTemplateConfiguration(container, buttonsEl);
	}
}

class SourceIdFirstSettingsImporter extends FormatImporter {
	protected override get sourceIdSettingFirst(): boolean {
		return true;
	}

	init(): void {
		this.idProperty = 'notion-id';
		this.idLabel = 'Notion ID';
		this.startGroup('template');
		this.addSetting('template')?.setName('Cover property');
		this.addSetting('template')?.setName('Database base');
		this.addSetting('template')?.setName('Single line breaks');
	}

	async import(): Promise<void> {}

	showSettings(container: HTMLElement, buttonsEl: HTMLElement): Promise<boolean> {
		return this.showNoteTemplateConfiguration(container, buttonsEl);
	}
}

class NestedConfigurationImporter extends FormatImporter {
	init(): void {}
	async import(): Promise<void> {}

	navigate<T>(
		initial: T,
		configure: (current: T) => Promise<T | null>,
		preview: (configured: T, back: Promise<void>) => Promise<boolean>,
	): Promise<boolean> {
		return this.showConfigurationBeforePreview(initial, configure, preview);
	}
}

test('the tags property uses Obsidian\'s tags icon instead of the generic list icon', () => {
	assert.equal(propertyIcon('tags', ['one', 'two']), 'lucide-tags');
	assert.equal(propertyIcon('Other list', ['one', 'two']), 'lucide-list');
});

test('the template screen is shown while only its preview is still loading', async () => {
	const subject = Object.create(LoadingPreviewImporter.prototype) as LoadingPreviewImporter;
	Object.assign(subject, { host: { importerId: 'test' } });

	const configured = subject.showTemplateConfiguration(
		new ImportContext(),
		{} as HTMLElement,
		{} as HTMLElement,
	);

	assert.equal(subject.configurationShown, true);
	assert.equal(await configured, true);

	subject.finishLoading();
	const preview = await subject.preview as { content: string }[];
	assert.equal(preview[0].content, 'Loaded content');
});

test('Back from a nested preview restores the preceding configuration', async () => {
	const navigation: { back: (() => unknown) | null } = { back: null };
	const subject = new NestedConfigurationImporter(memoryApp(new MemoryVault()), {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: {
			loadData: async () => ({ outputSettings: {}, outputLocations: {}, sourceFolders: {} }),
			saveData: async () => {},
		},
		importerId: 'nested-configuration',
		abortController: new AbortController(),
		setConfigurationBack: (back: (() => unknown) | null) => navigation.back = back,
	} as never);
	const configuredValues: string[] = [];
	let configureCalls = 0;

	const configuring = subject.navigate(
		'initial',
		async current => {
			configuredValues.push(current);
			return ++configureCalls === 1 ? 'edited' : null;
		},
		async (configured, back) => {
			configuredValues.push(`preview:${configured}`);
			await back;
			return false;
		},
	);
	await Promise.resolve();
	assert.ok(navigation.back);

	navigation.back?.();
	assert.equal(await configuring, false);
	assert.deepEqual(configuredValues, ['initial', 'preview:edited', 'edited']);
	assert.equal(navigation.back, null);
});

test('source identity is configured beside the template while existing-note behavior stays on output', async () => {
	const realShow = NoteTemplateConfigurator.prototype.show;
	const settingPrototype = Setting.prototype as unknown as Record<string, unknown>;
	const realAddDropdown = settingPrototype.addDropdown;
	const realAddToggle = settingPrototype.addToggle;
	settingPrototype.addDropdown = function(callback: (component: unknown) => void) {
		const component = {
			addOption() { return this; },
			setValue() { return this; },
			onChange() { return this; },
		};
		callback(component);
		return this;
	};
	settingPrototype.addToggle = function(callback: (component: unknown) => void) {
		const component = {
			setValue() { return this; },
			onChange() { return this; },
		};
		callback(component);
		return this;
	};
	let managedProperties: ManagedTemplateProperty[] = [];
	NoteTemplateConfigurator.prototype.show = async function(container) {
		const options = (this as unknown as {
			options: {
				configure?: (el: HTMLElement, changed: () => void) => void;
				managedProperties?: () => ManagedTemplateProperty[];
			};
		}).options;
		options.configure?.(container, () => {});
		managedProperties = options.managedProperties?.() ?? [];
		return { template: '{{content}}', path: '' };
	};
	const subject = new NoteSettingsImporter(memoryApp(new MemoryVault()), {
		sourceEl: createDiv(),
		outputEl: null,
		optionsEl: null,
		plugin: {
			loadData: async () => ({ outputSettings: {}, outputLocations: {}, sourceFolders: {} }),
			saveData: async () => {},
		},
		importerId: 'note-settings',
		abortController: new AbortController(),
	} as never);
	await subject.ready;

	try {
		const outputEl = createDiv();
		(subject as unknown as {
			addDuplicateHandlingSetting(contentEl: HTMLElement): void;
		}).addDuplicateHandlingSetting(outputEl);
		const container = createDiv();
		await subject.showSettings(container, createDiv());
		const reopenedContainer = createDiv();
		await subject.showSettings(reopenedContainer, createDiv());
		assert.equal(
			reopenedContainer.querySelectorAll('.importer-save-source-id').length,
			1,
			'reopening the template step should not duplicate its source ID setting',
		);
		const templateNames = Array.from(reopenedContainer.querySelectorAll('.setting-item-name'))
			.map(element => element.textContent);
		const outputNames = Array.from(outputEl.querySelectorAll('.setting-item-name'))
			.map(element => element.textContent);

		assert.ok(templateNames.includes('Save source ID'));
		assert.ok(!templateNames.includes('Existing notes'));
		assert.ok(outputNames.includes('Existing notes'));
		assert.ok(!outputNames.includes('Save source ID'));

		const propertyGroupNames = Array.from(reopenedContainer.querySelectorAll('.setting-group'))
			.map(group => Array.from(group.querySelectorAll('.setting-item-name'))
				.map(element => element.textContent))
			.find(names => names.includes('Cover property name'));
		assert.deepEqual(propertyGroupNames, [
			'Cover property name',
			'Database property name',
			'Save source ID',
		]);
		assert.deepEqual(managedProperties.map(property => [property.key, property.value]), [
			['source-id', '{{id}}'],
			['tags', '{{tags}}'],
		]);

		const ordered = new SourceIdFirstSettingsImporter(memoryApp(new MemoryVault()), {
			sourceEl: createDiv(),
			outputEl: null,
			optionsEl: null,
			plugin: {
				loadData: async () => ({ outputSettings: {}, outputLocations: {}, sourceFolders: {} }),
				saveData: async () => {},
			},
			importerId: 'source-id-first-settings',
			abortController: new AbortController(),
		} as never);
		await ordered.ready;
		const orderedContainer = createDiv();
		await ordered.showSettings(orderedContainer, createDiv());
		assert.deepEqual(
			Array.from(orderedContainer.querySelectorAll('.setting-item-name')).map(element => element.textContent),
			['Save Notion ID', 'Cover property', 'Database base', 'Single line breaks'],
		);
	}
	finally {
		NoteTemplateConfigurator.prototype.show = realShow;
		settingPrototype.addDropdown = realAddDropdown;
		settingPrototype.addToggle = realAddToggle;
	}
});
