import { htmlToMarkdown, moment } from 'obsidian';
import type { FrontMatterCache } from 'obsidian';
import { parseHTML, serializeFrontMatter } from '../../util';

const DATE_FORMAT = 'dddd, D MMMM YYYY';

const ASSET_TYPE_ALIASES = new Map<string, string>([
	['generic-map', 'location'],
	['multi-pin-map', 'location'],
]);

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

export interface JournalConversionOptions {
	frontMatter: boolean;
}

export function convertJournalEntry(htmlContent: string, options: JournalConversionOptions): string {
	const documentEl = parseHTML(htmlContent);
	const frontMatter = options.frontMatter
		? (collectFrontMatterTokens(documentEl) ?? {})
		: {};

	const entryDate = extractEntryDate(documentEl);
	if (entryDate) {
		frontMatter.date = entryDate;
	}

	let mdContent = htmlToMarkdown(buildEntryDocument(documentEl));

	if (Object.keys(frontMatter).length > 0) {
		const frontMatterText = serializeFrontMatter(frontMatter);
		if (frontMatterText) {
			mdContent = frontMatterText + mdContent;
		}
	}

	return mdContent;
}

function extractEntryDate(source: HTMLElement): string | undefined {
	const headerText = source.querySelector('.pageHeader')?.textContent?.trim();
	if (!headerText) return undefined;

	const parsed = moment(headerText, DATE_FORMAT);
	if (!parsed.isValid()) return undefined;

	return parsed.format('YYYY-MM-DD');
}

function buildEntryDocument(source: HTMLElement): HTMLElement {
	const doc = activeDocument.implementation.createHTMLDocument('');
	const wrapper = createEl('article');
	doc.body.appendChild(wrapper);

	const promptText = source.querySelector('.reflectionPrompt')?.textContent;
	appendParagraph(wrapper, promptText);

	const paragraphs = Array.from(source.querySelectorAll(BODY_PARAGRAPH_SELECTOR));
	for (const paragraph of paragraphs) {
		wrapper.appendChild(doc.importNode(paragraph, true));
	}

	return doc.documentElement;
}

function appendParagraph(parent: HTMLElement, text: string | undefined | null): void {
	const trimmed = text?.trim();
	if (!trimmed) return;

	const paragraph = createEl('p');
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

function parseOverlayTokens(item: Element): string[] {
	const collected = collectOverlayText(item);
	return splitTokens(collected);
}

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
