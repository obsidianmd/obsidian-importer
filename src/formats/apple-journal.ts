import { htmlToMarkdown, moment, normalizePath, Notice, Setting, TFile } from 'obsidian';
import type { FrontMatterCache, TFolder } from 'obsidian';
import type { PickedFile } from '../filesystem';
import { fs, os, path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import type { ImportContext } from '../main';
import { parseHTML, sanitizeFileName, serializeFrontMatter } from '../util';

const DATE_FORMAT = 'dddd, D MMMM YYYY';
const DEFAULT_OUTPUT_FOLDER = 'Journal';


// Apple does not document these; check Journal exports to derive the structure.
const ASSET_TYPE_ALIASES = new Map<string, string>([
	['generic-map', 'location'],
	['multi-pin-map', 'location'],
]);

// currently resource import is not supported
const IGNORED_ASSET_TYPES = new Set<string>(['photo', 'live-photo', 'video']);
const BODY_PARAGRAPH_SELECTOR = '.p2, .p3';
const OVERLAY_TEXT_SELECTORS = [
	'.gridItemOverlayHeader',
	'.gridItemOverlayFooter',
	'.gridItemOverlayText',
	'.activityType',
	'.activityMetrics',
	'.activityMetricsDistance',
	'.activityMetricsCalories',
	'.activityMetricsDuration',
	'.mediaTitle',
	'.mediaArtist',
	'.mediaCategory',
];

const DUPLICATE_HANDLING = {
	Skip: 'skip',
	ImportUpdated: 'import-updated',
	CreateCopy: 'create-copy',
} as const;

type DuplicateHandling = (typeof DUPLICATE_HANDLING)[keyof typeof DUPLICATE_HANDLING];
const DEFAULT_DUPLICATE_HANDLING = DUPLICATE_HANDLING.ImportUpdated;

export class AppleJournalImporter extends FormatImporter {
	private frontMatterEnabled = true;
	private duplicateHandling: DuplicateHandling = DEFAULT_DUPLICATE_HANDLING;

	init(): void {
		const defaultImportPath = detectDefaultEntriesPath();
		this.addFileChooserSetting(
			'Journal entries',
			['htm', 'html'],
			true,
			'Pick the Journal app exported folder',
			defaultImportPath
		);

		new Setting(this.modal.contentEl)
			.setName('Journal metadata')
			.setHeading();

		new Setting(this.modal.contentEl)
			.setName('Add metadata as frontmatter')
			.setDesc('Capture state-of-mind, contact, and similar tokens in YAML when available.')
			.addToggle(toggle => {
				toggle.setValue(this.frontMatterEnabled);
				toggle.onChange(value => {
					this.frontMatterEnabled = value;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Handle duplicate files')
			.setDesc('How to handle entries that already exist in the vault.')
			.addDropdown(dropdown => {
				dropdown
					.addOption(DUPLICATE_HANDLING.Skip, 'Skip import')
					.addOption(DUPLICATE_HANDLING.ImportUpdated, 'Import only updated')
					.addOption(DUPLICATE_HANDLING.CreateCopy, 'Create a copy')
					.setValue(DEFAULT_DUPLICATE_HANDLING)
					.onChange(value => {
						this.duplicateHandling = value as DuplicateHandling;
					});
			});

		this.addOutputLocationSetting(DEFAULT_OUTPUT_FOLDER);
	}

	async import(ctx: ImportContext): Promise<void> {
		if (this.files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.reportProgress(0, this.files.length);
		for (let index = 0; index < this.files.length; index++) {
			if (ctx.isCancelled()) return;

			const file = this.files[index];
			if (file.name === 'index.html') {
				ctx.reportSkipped(file.fullpath, 'index file is not a journal entry');
				ctx.reportProgress(index + 1, this.files.length);
				continue;
			}

			try {
				ctx.status(`Importing note ${file.basename}`);
				const imported = await this.importEntry(ctx, folder, file);
				if (imported) {
					ctx.reportNoteSuccess(file.fullpath);
				}
			}
			catch (error) {
				ctx.reportFailed(file.fullpath, error as Error);
			}

			ctx.reportProgress(index + 1, this.files.length);
		}
	}

	private async importEntry(ctx: ImportContext, folder: TFolder, file: PickedFile): Promise<boolean> {
		const htmlContent = await file.readText();
		const documentEl = parseHTML(htmlContent);
		const frontMatter = this.frontMatterEnabled
			? (collectFrontMatterTokens(documentEl) ?? {})
			: {};

		const entryDate = extractEntryDate(documentEl);
		if (entryDate) {
			frontMatter.date = entryDate;
		}

		const finalDocument = buildEntryDocument(documentEl);
		let mdContent = htmlToMarkdown(finalDocument);

		if (Object.keys(frontMatter).length > 0) {
			const frontMatterText = serializeFrontMatter(frontMatter);
			if (frontMatterText) {
				mdContent = frontMatterText + mdContent;
			}
		}

		const sanitizedName = sanitizeFileName(file.basename);
		const folderPath = folder.path === '/' ? '' : folder.path;
		const fullPath = normalizePath(path.join(folderPath, sanitizedName + '.md'));
		const existingFile = this.vault.getAbstractFileByPath(fullPath)
			?? this.vault.getAbstractFileByPathInsensitive(fullPath);

		if (this.duplicateHandling === DUPLICATE_HANDLING.CreateCopy) {
			await this.saveAsMarkdownFile(folder, file.basename, mdContent);
			return true;
		}

		if (existingFile instanceof TFile) {
			if (this.duplicateHandling === DUPLICATE_HANDLING.Skip) {
				ctx.reportSkipped(file.fullpath, 'file already exists');
				return false;
			}

			if (this.duplicateHandling === DUPLICATE_HANDLING.ImportUpdated) {
				const existingContent = await this.vault.read(existingFile);
				if (existingContent === mdContent) {
					ctx.reportSkipped(file.fullpath, 'journal entry unchanged since last import');
					return false;
				}
			}

			await this.vault.modify(existingFile, mdContent);
			return true;
		}

		await this.vault.create(fullPath, mdContent);
		return true;
	}
}

function extractEntryDate(source: HTMLElement): string | undefined {
	const headerText = source.querySelector('.pageHeader')?.textContent?.trim();
	if (!headerText) return undefined;

	/**
	 * Journal exports format the date as "Sunday, 3 November 2024".
	 */
	const parsed = moment(headerText, DATE_FORMAT);
	if (!parsed.isValid()) return undefined;

	return parsed.format('YYYY-MM-DD');
}

/**
 * Builds a clean document that only contains the reflection prompt and entry body paragraphs.
 */
function buildEntryDocument(source: HTMLElement): HTMLElement {
	const doc = document.implementation.createHTMLDocument('');
	const wrapper = doc.createElement('article');
	doc.body.appendChild(wrapper);

	const promptText = source.querySelector('.reflectionPrompt')?.textContent;
	appendParagraph(doc, wrapper, promptText);

	const paragraphs = Array.from(source.querySelectorAll(BODY_PARAGRAPH_SELECTOR));
	for (const paragraph of paragraphs) {
		wrapper.appendChild(doc.importNode(paragraph, true));
	}

	return doc.documentElement;
}

function appendParagraph(doc: Document, parent: HTMLElement, text: string | undefined | null): void {
	const trimmed = text?.trim();
	if (!trimmed) return;

	const paragraph = doc.createElement('p');
	paragraph.textContent = trimmed;
	parent.appendChild(paragraph);
}

function collectFrontMatterTokens(source: HTMLElement): FrontMatterCache | null {
	const tokensByType = new Map<string, Set<string>>();
	const items = Array.from(source.querySelectorAll('.assetGrid .gridItem'));

	for (const item of items) {
		const assetType = normalizeAssetType(item);
		if (!assetType || IGNORED_ASSET_TYPES.has(assetType)) continue;

		const tokens = parseOverlayTokens(item);
		if (tokens.length === 0) continue;

		const bucket = tokensByType.get(assetType) ?? new Set<string>();
		for (const token of tokens) {
			bucket.add(token);
		}
		tokensByType.set(assetType, bucket);
	}

	if (tokensByType.size === 0) return null;

	const frontMatter: FrontMatterCache = {};
	for (const [key, values] of tokensByType) {
		const list = Array.from(values);
		if (list.length > 0) {
			frontMatter[key] = list;
		}
	}

	return Object.keys(frontMatter).length === 0 ? null : frontMatter;
}

/**
 * Turns assetType class names into kebab-case frontmatter keys.
 */
function normalizeAssetType(item: Element): string | undefined {
	const className = Array.from(item.classList).find(cls => cls.startsWith('assetType_'));
	if (!className) return undefined;

	const rawType = className.slice('assetType_'.length);
	if (!rawType) return undefined;

	const normalized = rawType
		.replace(/(\w)([A-Z])/g, '$1-$2')
		.replace(/_/g, '-')
		.toLowerCase();

	return ASSET_TYPE_ALIASES.get(normalized) ?? normalized;
}

/**
 * Collects overlay strings and splits them into tokens (examples: "Memorial Hospital",
 * "John Smith", "Outdoor Walk, 2.3 km, 35 min", "Taylor Swift, Pop").
 */
function parseOverlayTokens(item: Element): string[] {
	const collected = collectOverlayText(item);
	return splitTokens(collected);
}

/**
 * Splits overlay strings into tokens while keeping title-like text intact.
 */
function splitTokens(values: string[]): string[] {
	const tokens = new Set<string>();
	for (const value of values) {
		for (const token of value.split(',')) {
			const trimmed = token.trim();
			if (trimmed) tokens.add(trimmed);
		}
	}
	return Array.from(tokens);
}

function collectOverlayText(item: Element): string[] {
	const values = new Set<string>();
	const addValue = (text: string | null | undefined): void => {
		const trimmed = text?.trim();
		if (trimmed) values.add(trimmed);
	};

	for (const selector of OVERLAY_TEXT_SELECTORS) {
		const elements = Array.from(item.querySelectorAll(selector));
		for (const element of elements) {
			addValue(element.textContent);
		}
	}

	const attributedElements = Array.from(item.querySelectorAll('[aria-label],[title],[alt]'));
	for (const element of attributedElements) {
		addValue(element.getAttribute('aria-label'));
		addValue(element.getAttribute('title'));
		addValue(element.getAttribute('alt'));
	}

	return Array.from(values);
}

function detectDefaultEntriesPath(): string | undefined {
	if (!fs || !path || !os) {
		return undefined;
	}

	if (os.platform() !== 'darwin') {
		return undefined;
	}

	const candidate = path.join(
		os.homedir(),
		'Library',
		'Mobile Documents',
		'com~apple~CloudDocs',
		'Journal',
		'AppleJournalEntries'
	);

	try {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	catch {
		return undefined;
	}

	return undefined;
}
