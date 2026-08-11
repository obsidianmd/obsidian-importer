/**
 * Object spaces into pages, and property sets into text.
 *
 * Ported from OfficeIMO's OneNoteSemanticMapper (MIT), covering the content an
 * import turns into markdown. Ink strokes, native math and note tags are read
 * past rather than mapped: they have no markdown to become, and an object this
 * does not recognise is skipped rather than failing the page around it.
 */

import { OneNoteFormatError } from '../errors';
import { ExtendedGuid } from '../onestore/file-header';
import { RevisionStoreObject, keyOf } from '../onestore/objects';
import { RevisionStore } from '../onestore/revision-store';
import { DEFAULT_READER_OPTIONS, ReaderOptions } from '../onestore/options';
import {
	Element,
	EmbeddedFile,
	Image,
	ListInfo,
	Outline,
	Page,
	Paragraph,
	Section,
	Table,
	TableRow,
	TextRun,
} from './content';
import { MaterializedObjectSpace, ObjectSpaceMaterializer, spaceKey } from './object-space';
import {
	readBoolean,
	readData,
	readFileTime,
	readReferences,
	readSingleByteString,
	readString,
	readTime32,
	readUInt32Array,
	readUInt32Property,
} from './properties';
import { Jcid, Property } from './schema';

export function mapSection(store: RevisionStore, options: ReaderOptions = DEFAULT_READER_OPTIONS): Section {
	const materializer = new ObjectSpaceMaterializer(store);
	const sectionSpace = materializer.findCurrentSpaceByRootJcid(Jcid.sectionNode);

	if (!sectionSpace) {
		throw new OneNoteFormatError('ONENOTE_SECTION_OBJECT_SPACE', 'No current section object space could be materialized.');
	}

	const section: Section = { name: '', pages: [] };
	const metadata = sectionSpace.getRoot(2);

	if (metadata?.jcid === Jcid.sectionMetadata) {
		section.name = readString(metadata, Property.sectionDisplayName) ?? '';
		section.colorArgb = readUInt32Property(metadata, Property.notebookColor);
	}

	const sectionRoot = sectionSpace.getRoot(1);
	if (!sectionRoot || sectionRoot.jcid !== Jcid.sectionNode) {
		throw new OneNoteFormatError('ONENOTE_SECTION_ROOT', 'The current root object space does not resolve to a section node.');
	}

	const visitedPages = new Set<string>();
	for (const pageSeriesId of readReferences(sectionRoot, Property.elementChildNodes)) {
		const pageSeries = sectionSpace.getObject(pageSeriesId);
		if (pageSeries?.jcid !== Jcid.pageSeriesNode) continue;

		for (const objectSpaceId of readReferences(pageSeries, Property.childGraphSpaceElementNodes)) {
			const page = mapPage(materializer, objectSpaceId, options, visitedPages);
			if (page) section.pages.push(page);
		}
	}

	return section;
}

function mapPage(
	materializer: ObjectSpaceMaterializer,
	objectSpaceId: ExtendedGuid,
	options: ReaderOptions,
	visitedPages: Set<string>,
): Page | undefined {
	const key = spaceKey(objectSpaceId);
	if (visitedPages.has(key) || visitedPages.size >= options.maxPageGraphNodes) return undefined;
	visitedPages.add(key);

	const space = materializer.tryGetSpace(objectSpaceId);
	if (!space) return undefined;

	const manifest = space.getRoot(1);
	if (manifest?.jcid !== Jcid.pageManifestNode) return undefined;

	const metadata = space.getRoot(2);
	const revisionMetadata = space.getRoot(4);

	let pageNode: RevisionStoreObject | undefined;
	for (const childId of readReferences(manifest, Property.contentChildNodes)) {
		const candidate = space.getObject(childId);
		if (candidate?.jcid === Jcid.pageNode) {
			pageNode = candidate;
			break;
		}
	}
	if (!pageNode) return undefined;

	const page: Page = {
		title: readString(metadata, Property.cachedTitleString) ?? readString(pageNode, Property.cachedTitleStringFromPage) ?? '',
		level: Math.max(0, (readUInt32Property(metadata, Property.pageLevel) ?? 1) - 1),
		createdUtc: readFileTime(metadata, Property.topologyCreationTimestamp),
		lastModifiedUtc: readFileTime(revisionMetadata, Property.lastModifiedTimestamp) ?? readTime32(pageNode, Property.lastModifiedTime),
		isConflictPage: readBoolean(metadata, Property.isConflictPage) ?? metadata?.jcid === Jcid.conflictPageMetadata,
		isDeleted: readData(metadata, Property.isDeletedGraphSpaceContent) !== undefined,
		outlines: [],
		directContent: [],
	};

	for (const childId of readReferences(pageNode, Property.elementChildNodes)) {
		const element = buildElement(space, materializer, childId, options, 0, new Set());
		if (element?.kind === 'outline') page.outlines.push(element);
		else if (element) page.directContent.push(element);
	}

	// A page whose title was never cached keeps it in a title node instead.
	if (page.title.trim() === '') {
		for (const titleId of readReferences(pageNode, Property.structureElementChildNodes)) {
			const title = space.getObject(titleId);
			if (title?.jcid !== Jcid.titleNode) continue;

			const parts: string[] = [];
			for (const childId of readReferences(title, Property.elementChildNodes)) {
				const element = buildElement(space, materializer, childId, options, 0, new Set());
				if (element) collectText(element, parts);
			}
			page.title = parts.filter(part => part.trim() !== '').join(' ').trim();
		}
	}

	return page;
}

function buildElement(
	space: MaterializedObjectSpace,
	materializer: ObjectSpaceMaterializer,
	id: ExtendedGuid,
	options: ReaderOptions,
	depth: number,
	path: Set<string>,
): Element | undefined {
	const pathKey = keyOf(id);
	if (depth >= options.maxPropertySetDepth || path.has(pathKey)) return undefined;
	path.add(pathKey);

	try {
		const item = space.getObject(id);
		if (!item) return undefined;

		switch (item.jcid) {
			case Jcid.outlineNode:
			case Jcid.outlineGroup: {
				const outline: Outline = { kind: 'outline', children: [] };
				for (const childId of readReferences(item, Property.elementChildNodes)) {
					const child = buildElement(space, materializer, childId, options, depth + 1, path);
					if (child) outline.children.push(child);
				}
				return outline;
			}

			case Jcid.outlineElementNode:
				return buildOutlineElement(space, materializer, item, options, depth, path);

			case Jcid.richTextNode:
				return buildParagraph(space, item);

			case Jcid.imageNode:
				return buildImage(space, materializer, item);

			case Jcid.embeddedFileNode:
				return buildEmbeddedFile(space, materializer, item);

			case Jcid.tableNode:
				return buildTable(space, materializer, item, options, depth, path);

			default:
				return undefined;
		}
	}
	finally {
		path.delete(pathKey);
	}
}

/**
 * An outline element is the row in a OneNote outline: it carries the indent
 * and list glyph, and wraps whatever content sits at that level.
 */
function buildOutlineElement(
	space: MaterializedObjectSpace,
	materializer: ObjectSpaceMaterializer,
	item: RevisionStoreObject,
	options: ReaderOptions,
	depth: number,
	path: Set<string>,
): Element {
	let primary: Element | undefined;
	for (const contentId of readReferences(item, Property.contentChildNodes)) {
		primary = buildElement(space, materializer, contentId, options, depth + 1, path);
		if (primary) break;
	}

	const list = buildListInfo(space, item);
	const children: Element[] = [];
	for (const childId of readReferences(item, Property.elementChildNodes)) {
		const child = buildElement(space, materializer, childId, options, depth + 1, path);
		if (child) children.push(child);
	}

	if (primary && primary.kind === 'paragraph') {
		primary.list = list;
		primary.children.push(...children);
		return primary;
	}

	if (primary) {
		return { kind: 'outline', list, children: [primary, ...children] };
	}

	return { kind: 'paragraph', runs: [], children, list };
}

function buildParagraph(space: MaterializedObjectSpace, item: RevisionStoreObject): Paragraph {
	const text = readString(item, Property.richEditTextUnicode) ?? readSingleByteString(item, Property.textExtendedAscii) ?? '';
	const boundaries = readUInt32Array(item, Property.textRunIndex);
	const styles = readReferences(item, Property.textRunFormatting);

	const runs: TextRun[] = [];
	let start = 0;
	const runCount = Math.max(1, boundaries.length + 1);

	for (let index = 0; index < runCount; index++) {
		let end = index < boundaries.length ? Math.min(text.length, boundaries[index]) : text.length;
		if (end < start) end = start;

		const run: TextRun = { text: text.slice(start, end) };
		if (index < styles.length) applyTextStyle(run, space.getObject(styles[index]));
		runs.push(run);
		start = end;
	}

	liftHyperlinkFields(runs);

	const paragraph: Paragraph = { kind: 'paragraph', runs, children: [] };

	for (const styleId of readReferences(item, Property.paragraphStyle)) {
		const style = space.getObject(styleId);
		if (!style) continue;
		paragraph.styleId = readString(style, Property.paragraphStyleId);
		break;
	}

	return paragraph;
}

/**
 * A link OneNote wrote inline rather than as a run style.
 *
 * It arrives as a Word field inside the text itself — U+FDDF, then
 * `HYPERLINK "target"`, then the words the reader actually sees. Left alone
 * the field code reads as content, so it becomes the run's target instead.
 */
const HYPERLINK_FIELD = /﷟\s*HYPERLINK\s+"([^"]*)"\s*/;

function liftHyperlinkFields(runs: TextRun[]): void {
	let pending: string | undefined;

	for (const run of runs) {
		const field = run.text.match(HYPERLINK_FIELD);

		if (field) {
			run.text = run.text.replace(HYPERLINK_FIELD, '');
			pending = field[1];
		}

		if (pending === undefined || run.text === '') continue;

		// The words after the field are the ones the link is on.
		run.hyperlinkUrl ??= pending;
		pending = undefined;
	}
}

function applyTextStyle(run: TextRun, style: RevisionStoreObject | undefined): void {
	if (!style) return;

	if (readBoolean(style, Property.bold)) run.bold = true;
	if (readBoolean(style, Property.italic)) run.italic = true;
	if (readBoolean(style, Property.underline)) run.underline = true;
	if (readBoolean(style, Property.strikethrough)) run.strikethrough = true;
	if (readBoolean(style, Property.superscript)) run.superscript = true;
	if (readBoolean(style, Property.subscript)) run.subscript = true;

	if (readBoolean(style, Property.hyperlink)) {
		const url = readString(style, Property.hyperlinkUrl);
		if (url) run.hyperlinkUrl = url;
	}
}

/**
 * Only an outline element carrying a list node is a list item — every element
 * has an indent level, so the level alone would bullet the whole page.
 */
function buildListInfo(space: MaterializedObjectSpace, item: RevisionStoreObject): ListInfo | undefined {
	let listNode: RevisionStoreObject | undefined;
	for (const listId of readReferences(item, Property.listNodes)) {
		const candidate = space.getObject(listId);
		if (candidate?.jcid === Jcid.numberListNode) listNode = candidate;
	}
	if (!listNode) return undefined;

	const format = readNumberListFormat(listNode);

	// The glyph OneNote substitutes the number into; without it the list is bulleted.
	const marker = format.indexOf('�');

	return {
		level: Math.max(0, (readUInt32Property(item, Property.outlineElementChildLevel) ?? 1) - 1),
		ordered: marker >= 0,
		format: format === '' ? undefined : format,
	};
}

/** The format is a counted string: its first character says how long the rest is. */
function readNumberListFormat(listNode: RevisionStoreObject): string {
	const data = readData(listNode, Property.numberListFormat);
	if (!data || data.length < 2) return '';

	const value = new TextDecoder('utf-16le').decode(data.subarray(0, data.length - (data.length % 2)));
	if (value.length === 0) return '';

	return value.slice(1, 1 + Math.min(value.charCodeAt(0), value.length - 1));
}

function buildTable(
	space: MaterializedObjectSpace,
	materializer: ObjectSpaceMaterializer,
	item: RevisionStoreObject,
	options: ReaderOptions,
	depth: number,
	path: Set<string>,
): Table {
	const table: Table = {
		kind: 'table',
		bordersVisible: readBoolean(item, Property.tableBordersVisible) ?? false,
		rows: [],
	};

	for (const rowId of readReferences(item, Property.elementChildNodes)) {
		const rowItem = space.getObject(rowId);
		if (rowItem?.jcid !== Jcid.tableRowNode) continue;

		const row: TableRow = { cells: [] };
		for (const cellId of readReferences(rowItem, Property.elementChildNodes)) {
			const cellItem = space.getObject(cellId);
			if (cellItem?.jcid !== Jcid.tableCellNode) continue;

			const children: Element[] = [];
			for (const childId of readReferences(cellItem, Property.elementChildNodes)) {
				const child = buildElement(space, materializer, childId, options, depth + 1, path);
				if (child) children.push(child);
			}
			row.cells.push({ children });
		}

		table.rows.push(row);
	}

	return table;
}

function buildImage(space: MaterializedObjectSpace, materializer: ObjectSpaceMaterializer, item: RevisionStoreObject): Image {
	const image: Image = {
		kind: 'image',
		fileName: readString(item, Property.imageFilename),
		altText: readString(item, Property.imageAltText),
	};

	for (const containerId of readReferences(item, Property.pictureContainer)) {
		const container = space.getObject(containerId);
		if (!container) continue;

		image.extension = readString(container, Property.fileDataExtension) ?? container.fileExtension;
		image.data = materializer.resolveFileData(container);
		break;
	}

	return image;
}

function buildEmbeddedFile(space: MaterializedObjectSpace, materializer: ObjectSpaceMaterializer, item: RevisionStoreObject): EmbeddedFile {
	const embedded: EmbeddedFile = {
		kind: 'embedded-file',
		fileName: readString(item, Property.embeddedFileName),
		sourcePath: readString(item, Property.sourceFilePath),
	};

	for (const containerId of readReferences(item, Property.embeddedFileContainer)) {
		const container = space.getObject(containerId);
		if (!container) continue;

		embedded.extension = readString(container, Property.fileDataExtension) ?? container.fileExtension;
		embedded.data = materializer.resolveFileData(container);
		break;
	}

	return embedded;
}

/** Every string an element holds, in reading order. */
export function collectText(element: Element, into: string[]): void {
	switch (element.kind) {
		case 'paragraph':
			for (const run of element.runs) into.push(run.text);
			for (const child of element.children) collectText(child, into);
			break;
		case 'outline':
			for (const child of element.children) collectText(child, into);
			break;
		case 'table':
			for (const row of element.rows) {
				for (const cell of row.cells) {
					for (const child of cell.children) collectText(child, into);
				}
			}
			break;
		default:
			break;
	}
}
