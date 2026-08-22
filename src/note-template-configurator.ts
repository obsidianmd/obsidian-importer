import { App, ButtonComponent, MarkdownRenderChild, MarkdownRenderer, normalizePath, Notice, parseYaml, setIcon, Setting, SettingGroup, stringifyYaml, TFile } from 'obsidian';
import { i18n } from './i18n';
import { MarkdownFileSuggest } from './markdown-file-suggest';
import { parseFrontMatterBlock } from './util';

export interface NoteTemplatePreview {
	content: string;
	label?: string;
	path?: string;
	diagnostics?: string[];
	/** False only for fatal template errors; warnings may still be imported. */
	valid?: boolean;
}

export interface NoteTemplateEditorConfig {
	template: string;
	path: string;
}

export interface NoteTemplateConfiguratorOptions {
	app: App;
	/** Generated template restored when the selected file is cleared. */
	defaultTemplate: string;
	template: string;
	path?: string;
	preview: (template: string) => Promise<NoteTemplatePreview | NoteTemplatePreview[]>;
	/** Additional note-writing settings shown between the template file and preview. */
	configure?: (container: HTMLElement, previewChanged: () => void) => void;
}

function markdownPath(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	return normalizePath(trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`);
}

function previewTitle(preview: NoteTemplatePreview): string {
	if (preview.label) return preview.label;
	const name = preview.path?.slice((preview.path.lastIndexOf('/') ?? -1) + 1) ?? '';
	return name.replace(/\.md$/i, '');
}

function displayPropertyValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function propertyIcon(value: unknown): string {
	if (Array.isArray(value)) return 'lucide-list';
	if (typeof value === 'boolean') return 'lucide-check-square';
	if (typeof value === 'number') return 'lucide-binary';
	if (value && typeof value === 'object') return 'lucide-file-json';
	return 'lucide-text';
}

interface EditableProperty {
	key: string;
	value: unknown;
}

const TEMPLATE_FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TEMPLATE_EXPRESSION_PATTERN = /({{[\s\S]*?}}|{%[\s\S]*?%})/g;
const TEMPLATE_EXPRESSION_TOKEN = '__KNAP_TEMPLATE_EXPRESSION_';

function protectTemplateExpressions(value: string, expressions: string[]): string {
	return value.replace(TEMPLATE_EXPRESSION_PATTERN, expression => {
		const token = `${TEMPLATE_EXPRESSION_TOKEN}${expressions.length}__`;
		expressions.push(expression);
		return token;
	});
}

function restoreTemplateExpressions(value: string, expressions: string[]): string {
	return value.replace(/__KNAP_TEMPLATE_EXPRESSION_(\d+)__/g, (token, index: string) =>
		expressions[Number(index)] ?? token);
}

function transformTemplateExpressions(
	value: unknown,
	transform: (text: string) => string,
): unknown {
	if (typeof value === 'string') return transform(value);
	if (Array.isArray(value)) return value.map(item => transformTemplateExpressions(item, transform));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [
			transform(key),
			transformTemplateExpressions(item, transform),
		]));
	}
	return value;
}

function parseTemplateFrontMatter(template: string): { properties: EditableProperty[], body: string } | null {
	const match = TEMPLATE_FRONT_MATTER_PATTERN.exec(template);
	if (!match) return null;

	const expressions: string[] = [];
	try {
		const protectedYaml = protectTemplateExpressions(match[1], expressions);
		const parsed: unknown = parseYaml(protectedYaml);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const restored = transformTemplateExpressions(
			parsed,
			value => restoreTemplateExpressions(value, expressions),
		) as Record<string, unknown>;
		return {
			properties: Object.entries(restored).map(([key, value]) => ({ key, value })),
			body: template.slice(match[0].length),
		};
	}
	catch {
		return null;
	}
}

function serializeTemplate(properties: EditableProperty[], body: string): string {
	const entries = properties.filter(property => property.key.trim());
	if (entries.length === 0) return body;

	const expressions: string[] = [];
	const frontMatter = Object.fromEntries(entries.map(property => [property.key.trim(), property.value]));
	const protectedFrontMatter = transformTemplateExpressions(
		frontMatter,
		value => protectTemplateExpressions(value, expressions),
	);
	const yaml = stringifyYaml(protectedFrontMatter);
	return restoreTemplateExpressions(`---\n${yaml}---\n${body}`, expressions);
}

function editablePropertyValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function parseEditablePropertyValue(value: string): unknown {
	if (!value) return '';
	const expressions: string[] = [];
	try {
		const parsed: unknown = parseYaml(protectTemplateExpressions(value, expressions));
		return transformTemplateExpressions(
			parsed,
			text => restoreTemplateExpressions(text, expressions),
		);
	}
	catch {
		return value;
	}
}

function renderProperties(container: HTMLElement, properties: Record<string, unknown>): void {
	const propertyEntries = Object.entries(properties);

	// MetadataEditor is internal to Obsidian. Keep this read-only DOM aligned with
	// its structure so the app and the user's theme provide the real appearance.
	const metadata = container.createDiv({
		cls: 'metadata-container importer-template-properties',
		attr: { tabindex: -1, 'data-property-count': propertyEntries.length },
	});
	metadata.createDiv('metadata-error-container').toggle(false);
	const heading = metadata.createDiv({ cls: 'metadata-properties-heading', attr: { tabindex: -1 } });
	const collapse = heading.createDiv('collapse-indicator collapse-icon');
	setIcon(collapse, 'right-triangle');
	heading.createDiv({ cls: 'metadata-properties-title', text: i18n.template.headingProperties() });

	const content = metadata.createDiv('metadata-content');
	const rows = content.createDiv('metadata-properties');
	for (const [key, value] of propertyEntries) {
		const row = rows.createDiv({
			cls: 'metadata-property importer-template-property',
			attr: { tabindex: -1, 'data-property-key': key.toLowerCase() },
		});
		const keyEl = row.createDiv('metadata-property-key');
		const icon = keyEl.createSpan('metadata-property-icon');
		setIcon(icon, propertyIcon(value));
		keyEl.createEl('input', {
			cls: 'metadata-property-key-input',
			type: 'text',
			value: key,
			attr: { readonly: true, tabindex: -1 },
		});
		const valueEl = row.createDiv('metadata-property-value importer-template-property-value');
		valueEl.dataset.propertyType = Array.isArray(value) ? 'multitext' : typeof value;
		if (Array.isArray(value)) {
			const values = valueEl.createDiv('multi-select-container');
			for (const item of value) {
				values.createDiv({
					cls: 'multi-select-pill',
					text: displayPropertyValue(item),
				});
			}
		}
		else if (typeof value === 'boolean') {
			const input = valueEl.createEl('input', {
				type: 'checkbox',
				cls: 'metadata-input-checkbox',
				attr: { disabled: true, tabindex: -1 },
			});
			input.checked = value;
		}
		else if (typeof value === 'number') {
			valueEl.createEl('input', {
				type: 'number',
				cls: 'metadata-input-number',
				value: String(value),
				attr: { readonly: true, tabindex: -1 },
			});
		}
		else if (value && typeof value === 'object') {
			valueEl.createSpan({
				cls: 'metadata-property-value-item mod-unknown',
				text: displayPropertyValue(value),
			});
		}
		else {
			valueEl.createEl('textarea', {
				cls: 'metadata-input-text metadata-input-longtext',
				text: displayPropertyValue(value),
				attr: { readonly: true, tabindex: -1, rows: 1 },
			});
		}
	}

	const addProperty = content.createDiv({
		cls: 'metadata-add-button text-icon-button',
		attr: { tabindex: -1, 'aria-disabled': true },
	});
	const addIcon = addProperty.createSpan('text-button-icon');
	setIcon(addIcon, 'lucide-plus');
	addProperty.createSpan({
		cls: 'text-button-label',
		text: i18n.template.buttonAddProperty(),
	});
}

function renderEditableProperties(container: HTMLElement, properties: EditableProperty[]): void {
	const metadata = container.createDiv({
		cls: 'metadata-container importer-template-properties is-editable',
		attr: { tabindex: -1 },
	});
	metadata.createDiv('metadata-error-container').toggle(false);
	const heading = metadata.createDiv({ cls: 'metadata-properties-heading', attr: { tabindex: -1 } });
	const collapse = heading.createDiv('collapse-indicator collapse-icon');
	setIcon(collapse, 'right-triangle');
	heading.createDiv({ cls: 'metadata-properties-title', text: i18n.template.headingProperties() });

	const content = metadata.createDiv('metadata-content');
	const rows = content.createDiv('metadata-properties');
	const renderRows = (focusIndex?: number): void => {
		rows.empty();
		metadata.dataset.propertyCount = String(properties.length);
		for (const [index, property] of properties.entries()) {
			const row = rows.createDiv({
				cls: 'metadata-property importer-template-property',
				attr: { 'data-property-key': property.key.toLowerCase() },
			});
			const keyEl = row.createDiv('metadata-property-key');
			const icon = keyEl.createSpan('metadata-property-icon');
			setIcon(icon, propertyIcon(property.value));
			const keyInput = keyEl.createEl('input', {
				cls: 'metadata-property-key-input',
				type: 'text',
				value: property.key,
			});
			keyInput.addEventListener('input', () => {
				property.key = keyInput.value;
				row.dataset.propertyKey = property.key.toLowerCase();
			});

			const valueEl = row.createDiv('metadata-property-value importer-template-property-value');
			valueEl.dataset.propertyType = 'text';
			const valueInput = valueEl.createEl('textarea', {
				cls: 'metadata-input-text metadata-input-longtext',
				text: editablePropertyValue(property.value),
				attr: { rows: 1 },
			});
			valueInput.addEventListener('input', () => {
				property.value = parseEditablePropertyValue(valueInput.value);
			});
			if (focusIndex === index) keyInput.focus();
		}
	};

	const addProperty = content.createDiv({
		cls: 'metadata-add-button text-icon-button',
		attr: { tabindex: 0, role: 'button' },
	});
	const addIcon = addProperty.createSpan('text-button-icon');
	setIcon(addIcon, 'lucide-plus');
	addProperty.createSpan({
		cls: 'text-button-label',
		text: i18n.template.buttonAddProperty(),
	});
	const add = (): void => {
		properties.push({ key: '', value: '' });
		renderRows(properties.length - 1);
	};
	addProperty.addEventListener('click', add);
	addProperty.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		add();
	});
	renderRows();
}

/** Shared Markdown-template preview and persistence screen used by every note-producing importer. */
export class NoteTemplateConfigurator {
	private template: string;
	private path: string;

	constructor(private readonly options: NoteTemplateConfiguratorOptions) {
		this.template = options.template;
		this.path = options.path ?? '';
	}

	async show(container: HTMLElement, buttonsEl: HTMLElement): Promise<NoteTemplateEditorConfig> {
		return await new Promise(resolve => {
			container.empty();
			container.createDiv({
				cls: 'importer-screen-desc',
				text: i18n.template.msgNoteTemplateIntro(),
			});

			const fileGroup = new SettingGroup(container);
			const fileSetting = new Setting(fileGroup.listEl)
				.setName(i18n.template.nameTemplateFile())
				.setDesc(i18n.template.descTemplateFile());
			const pathInput = fileSetting.controlEl.createEl('input', {
				type: 'text',
				value: this.path,
				placeholder: i18n.output.placeholderTemplate(),
			});
			new MarkdownFileSuggest(this.options.app, pathInput);

			let editing = false;
			let editorEl: HTMLTextAreaElement | null = null;
			let editorProperties: EditableProperty[] = [];
			let revision = 0;
			let templateLoadRevision = 0;
			let sampleIndex = 0;
			let samples: NoteTemplatePreview[] = [];
			let renderComponent: MarkdownRenderChild | null = null;
			let updatePreview = async (): Promise<boolean> => false;

			this.options.configure?.(container, () => void updatePreview());

			const previewGroup = new SettingGroup(container);
			const previewSetting = new Setting(previewGroup.listEl)
				.setName(i18n.template.headingPreview());
			const editButton = new ButtonComponent(previewSetting.controlEl)
				.setButtonText(i18n.template.buttonEditTemplate());
			const previewDiagnostics = previewGroup.listEl.createDiv('importer-template-diagnostics');
			const previewNav = previewGroup.listEl.createDiv('importer-template-preview-nav');
			const previousButton = previewNav.createEl('button');
			setIcon(previousButton, 'lucide-chevron-left');
			previousButton.setAttr('aria-label', i18n.template.buttonPreviousPreview());
			const nextButton = previewNav.createEl('button');
			setIcon(nextButton, 'lucide-chevron-right');
			nextButton.setAttr('aria-label', i18n.template.buttonNextPreview());
			previewNav.toggle(false);
			const preview = previewGroup.listEl.createDiv('importer-template-preview');
			const showPreviewLoading = (): void => {
				renderComponent?.unload();
				renderComponent = null;
				preview.empty();
				previewDiagnostics.empty();
				previewNav.hide();
				const loading = preview.createDiv('importer-loading importer-template-preview-loading');
				setIcon(loading.createDiv('loader-spinner'), 'loader-2');
				loading.createDiv({
					text: i18n.common.statusProcessing({ name: i18n.template.headingPreview() }),
				});
			};

			const renderPreview = async (current: number): Promise<boolean> => {
				let candidateComponent: MarkdownRenderChild | null = null;
				try {
					const result = samples[sampleIndex];
					if (!result || current !== revision) return false;

					const rendered = createDiv('markdown-preview-view markdown-rendered importer-template-rendered-note');
					const parsed = parseFrontMatterBlock(result.content);
					rendered.createDiv({
						cls: 'inline-title',
						text: previewTitle(result),
						attr: { contenteditable: false, tabindex: -1 },
					});
					renderProperties(rendered, parsed?.frontMatter ?? {});
					const markdown = rendered.createDiv('importer-template-markdown');
					candidateComponent = new MarkdownRenderChild(rendered);
					candidateComponent.load();
					await MarkdownRenderer.render(
						this.options.app,
						parsed?.body ?? result.content,
						markdown,
						result.path ?? '',
						candidateComponent,
					);
					if (current !== revision) {
						candidateComponent.unload();
						return false;
					}

					renderComponent?.unload();
					renderComponent = candidateComponent;
					candidateComponent = null;
					preview.empty();
					preview.append(rendered);
					previewNav.toggle(samples.length > 1);
					previewDiagnostics.empty();
					for (const diagnostic of result.diagnostics ?? []) {
						previewDiagnostics.createDiv({ text: diagnostic });
					}
					return result.valid ?? !result.diagnostics?.length;
				}
				catch (error) {
					candidateComponent?.unload();
					if (current !== revision) return false;
					preview.empty();
					previewDiagnostics.setText(error instanceof Error ? error.message : String(error));
					return false;
				}
			};

			const setEditing = (value: boolean): void => {
				editing = value;
				editButton.setButtonText(value
					? i18n.template.buttonSaveTemplate()
					: i18n.template.buttonEditTemplate());
				if (value) editButton.setCta();
				else editButton.removeCta();
			};

			const startEditing = (): void => {
				++revision;
				renderComponent?.unload();
				renderComponent = null;
				preview.empty();
				previewDiagnostics.empty();
				previewNav.hide();
				const sample = samples[sampleIndex];
				const parsedTemplate = parseTemplateFrontMatter(this.template);
				editorProperties = parsedTemplate?.properties ?? [];
				const rendered = preview.createDiv(
					'markdown-preview-view markdown-rendered importer-template-rendered-note importer-template-editing-note');
				rendered.createDiv({
					cls: 'inline-title',
					text: sample ? previewTitle(sample) : '',
					attr: { contenteditable: false, tabindex: -1 },
				});
				renderEditableProperties(rendered, editorProperties);
				editorEl = rendered.createEl('textarea', {
					cls: 'importer-template-editor',
					attr: {
						'aria-label': i18n.template.nameTemplateEditor(),
						spellcheck: false,
					},
				});
				editorEl.value = parsedTemplate?.body ?? this.template;
				setEditing(true);
				editorEl.focus();
			};

			const finishEditing = (): void => {
				if (!editing || !editorEl) return;
				const editedTemplate = serializeTemplate(editorProperties, editorEl.value);
				if (editedTemplate !== this.template) {
					this.template = editedTemplate;
					this.path = '';
					pathInput.value = '';
				}
				editorEl = null;
				++templateLoadRevision;
				setEditing(false);
			};

			updatePreview = async (): Promise<boolean> => {
				const current = ++revision;
				showPreviewLoading();
				try {
					const result = await this.options.preview(this.template);
					if (current !== revision) return false;
					samples = Array.isArray(result) ? result : [result];
					sampleIndex = Math.min(sampleIndex, Math.max(0, samples.length - 1));
					return await renderPreview(current);
				}
				catch (error) {
					if (current !== revision) return false;
					preview.empty();
					previewDiagnostics.setText(error instanceof Error ? error.message : String(error));
					return false;
				}
			};

			editButton.onClick(() => {
				if (!editing) {
					startEditing();
					return;
				}

				finishEditing();
				void updatePreview();
			});

			previousButton.addEventListener('click', () => {
				if (samples.length < 2) return;
				sampleIndex = (sampleIndex - 1 + samples.length) % samples.length;
				void renderPreview(++revision);
			});
			nextButton.addEventListener('click', () => {
				if (samples.length < 2) return;
				sampleIndex = (sampleIndex + 1) % samples.length;
				void renderPreview(++revision);
			});

			const loadTemplate = async (): Promise<void> => {
				const current = ++templateLoadRevision;
				const path = markdownPath(pathInput.value);
				const hadTemplatePath = this.path !== '';
				this.path = '';
				const resetTemplate = async (): Promise<void> => {
					if (!hadTemplatePath) return;
					this.template = this.options.defaultTemplate;
					setEditing(false);
					editorEl = null;
					await updatePreview();
				};
				if (!path) {
					await resetTemplate();
					return;
				}
				const file = this.options.app.vault.getAbstractFileByPath(path)
					?? this.options.app.vault.getAbstractFileByPathInsensitive(path);
				// Partial paths while typing are expected. Suggestions trigger this same
				// event once they have placed a complete path in the input.
				if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
					await resetTemplate();
					return;
				}
				try {
					const loaded = await this.options.app.vault.cachedRead(file);
					if (current !== templateLoadRevision) return;
					this.template = loaded;
					this.path = file.path;
					pathInput.value = file.path;
					setEditing(false);
					editorEl = null;
					await updatePreview();
				}
				catch (error) {
					if (current !== templateLoadRevision) return;
					new Notice(error instanceof Error ? error.message : String(error));
				}
			};
			pathInput.addEventListener('input', () => void loadTemplate());

			buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonImport() }, button => {
				button.addEventListener('click', () => {
					finishEditing();
					void updatePreview().then(valid => {
						if (!valid) return;
						renderComponent?.unload();
						resolve({ template: this.template, path: this.path });
					});
				});
			});

			void updatePreview();
		});
	}
}
