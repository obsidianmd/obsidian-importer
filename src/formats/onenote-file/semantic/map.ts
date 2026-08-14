/** Maps object spaces to importable content.
 * Ported from OfficeIMO's OneNoteSemanticMapper (MIT). */

import { OneNoteFormatError } from '../errors';
import { readUInt32 } from '../onestore/binary';
import { ExtendedGuid } from '../onestore/file-header';
import { RevisionStoreObject, keyOf } from '../onestore/objects';
import { PropertySet } from '../onestore/property-set';
import { RevisionStore } from '../onestore/revision-store';
import { DEFAULT_READER_OPTIONS, ReaderOptions } from '../onestore/options';
import {
	Element,
	EmbeddedFile,
	Image,
	Ink,
	InkStroke,
	ListInfo,
	Outline,
	Page,
	Paragraph,
	Section,
	Table,
	TableRow,
	Tag,
	TextRun,
} from './content';
import {
	InkDimensionId,
	NATIVE_UNITS_PER_HALF_INCH,
	decodeDimensions,
	decodeInkColor,
	decodePacketValues,
	decodeRecognitionAlternatives,
	decodeSignedVector,
	indexOfDimension,
} from './ink';
import { MaterializedObjectSpace, ObjectSpaceMaterializer, spaceKey } from './object-space';
import {
	findProperty,
	readBoolean,
	readData,
	readFileTime,
	readFloat,
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
		id: keyOf(objectSpaceId),
		title: readString(metadata, Property.cachedTitleString) ?? readString(pageNode, Property.cachedTitleStringFromPage) ?? '',
		level: Math.max(0, (readUInt32Property(metadata, Property.pageLevel) ?? 1) - 1),
		createdUtc: readFileTime(metadata, Property.topologyCreationTimestamp),
		lastModifiedUtc: readFileTime(revisionMetadata, Property.lastModifiedTimestamp) ?? readTime32(pageNode, Property.lastModifiedTime),
		isConflictPage: readBoolean(metadata, Property.isConflictPage) ?? metadata?.jcid === Jcid.conflictPageMetadata,
		isDeleted: readData(metadata, Property.isDeletedGraphSpaceContent) !== undefined,
		outlines: [],
		directContent: [],
	};

	const context: MapContext = {
		space,
		materializer,
		options,
		recognition: collectRecognition(space, pageNode),
	};

	for (const childId of readReferences(pageNode, Property.elementChildNodes)) {
		const element = buildElement(context, childId, 0, new Set());
		if (element?.kind === 'outline') page.outlines.push(element);
		else if (element) page.directContent.push(element);
	}

	if (page.title.trim() === '') {
		for (const titleId of readReferences(pageNode, Property.structureElementChildNodes)) {
			const title = space.getObject(titleId);
			if (title?.jcid !== Jcid.titleNode) continue;

			const parts: string[] = [];
			for (const childId of readReferences(title, Property.elementChildNodes)) {
				const element = buildElement(context, childId, 0, new Set());
				if (element) collectText(element, parts);
			}
			page.title = parts.filter(part => part.trim() !== '').join(' ').trim();
		}
	}

	return page;
}

interface MapContext {
	space: MaterializedObjectSpace;
	materializer: ObjectSpaceMaterializer;
	options: ReaderOptions;
	recognition: Map<string, string>;
}

function buildElement(
	context: MapContext,
	id: ExtendedGuid,
	depth: number,
	path: Set<string>,
): Element | undefined {
	const { space, options } = context;
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
					const child = buildElement(context, childId, depth + 1, path);
					if (child) outline.children.push(child);
				}
				return outline;
			}

			case Jcid.outlineElementNode:
				return buildOutlineElement(context, item, depth, path);

			case Jcid.richTextNode:
				return buildParagraph(context.space, item);

			case Jcid.imageNode:
				return buildImage(context, item);

			case Jcid.embeddedFileNode:
				return buildEmbeddedFile(context, item);

			case Jcid.tableNode:
				return buildTable(context, item, depth, path);

			case Jcid.inkContainer:
				return buildInk(context, item);

			default:
				return undefined;
		}
	}
	finally {
		path.delete(pathKey);
	}
}

function buildOutlineElement(
	context: MapContext,
	item: RevisionStoreObject,
	depth: number,
	path: Set<string>,
): Element {
	const { space } = context;
	let primary: Element | undefined;
	for (const contentId of readReferences(item, Property.contentChildNodes)) {
		primary = buildElement(context, contentId, depth + 1, path);
		if (primary) break;
	}

	const list = buildListInfo(space, item);
	const children: Element[] = [];
	for (const childId of readReferences(item, Property.elementChildNodes)) {
		const child = buildElement(context, childId, depth + 1, path);
		if (child) children.push(child);
	}

	const tags = buildTags(space, item);

	if (primary && primary.kind === 'paragraph') {
		primary.list = list;
		primary.tags ??= tags;
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

	const paragraph: Paragraph = { kind: 'paragraph', runs, children: [], tags: buildTags(space, item) };

	for (const styleId of readReferences(item, Property.paragraphStyle)) {
		const style = space.getObject(styleId);
		if (!style) continue;
		paragraph.styleId = readString(style, Property.paragraphStyleId);
		break;
	}

	return paragraph;
}

/** Finds Word HYPERLINK fields embedded in text. */
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

		run.hyperlinkUrl ??= pending;
		pending = undefined;
	}
}

function applyTextStyle(run: TextRun, style: RevisionStoreObject | undefined): void {
	if (!style) return;

	if (readBoolean(style, Property.mathFormatting)) run.math = true;
	const highlight = highlightColor(readUInt32Property(style, Property.highlight));
	if (highlight) run.highlight = highlight;
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

/** OneNote stores colors as 0x00BBGGRR. */
function highlightColor(color: number | undefined): string | undefined {
	if (color === undefined || (color & 0xff000000) !== 0) return undefined;
	if ((color & 0xffffff) === 0xffffff) return undefined;

	const channel = (shift: number) => ((color >> shift) & 0xff).toString(16).padStart(2, '0');
	return `#${channel(0)}${channel(8)}${channel(16)}`;
}

/** Maps tags by shape because labels are localized. */
function buildTags(space: MaterializedObjectSpace, item: RevisionStoreObject): Tag[] | undefined {
	const states = findProperty(item.propertySet, Property.noteTagStates)?.childPropertySets;
	if (!states || states.length === 0) return undefined;

	const tags: Tag[] = [];
	for (const state of states.slice(0, MAX_TAGS_PER_PARAGRAPH)) {
		const status = readSetUInt32(state, Property.actionItemStatus) ?? 0;

		if ((status & 0x10) !== 0) continue;

		const definitionId = findProperty(state, Property.noteTagDefinitionOid)?.referencedIds?.[0];
		const definition = definitionId ? space.getObject(definitionId) : undefined;
		const shape = readSetUInt32(state, Property.noteTagShape) ??
			(definition?.jcid === Jcid.noteTagSharedDefinition ? readUInt32Property(definition, Property.noteTagShape) : undefined);

		const checkable = shape !== undefined && isCheckableShape(shape);

		tags.push({
			checkable,
			completed: (status & 0x01) !== 0,
			label: checkable ? undefined : readString(definition, Property.noteTagLabel),
			shape,
		});
	}

	return tags.length > 0 ? tags : undefined;
}

function isCheckableShape(shape: number): boolean {
	if (shape >= 1 && shape <= 12) return true;
	if (shape === 28 || shape === 30 || shape === 32) return true;
	if (shape === 48 || shape === 50 || shape === 52) return true;
	if (shape === 69 || shape === 71 || shape === 73) return true;
	return shape >= 89 && shape <= 99;
}

function readSetUInt32(set: PropertySet, propertyId: number): number | undefined {
	return findProperty(set, propertyId)?.scalarValue;
}

const MAX_TAGS_PER_PARAGRAPH = 9;

function buildListInfo(space: MaterializedObjectSpace, item: RevisionStoreObject): ListInfo | undefined {
	let listNode: RevisionStoreObject | undefined;
	for (const listId of readReferences(item, Property.listNodes)) {
		const candidate = space.getObject(listId);
		if (candidate?.jcid === Jcid.numberListNode) listNode = candidate;
	}
	if (!listNode) return undefined;

	const format = readNumberListFormat(listNode);

	// Ordered-list formats contain a number placeholder.
	const marker = format.indexOf('�');

	return {
		level: Math.max(0, (readUInt32Property(item, Property.outlineElementChildLevel) ?? 1) - 1),
		ordered: marker >= 0,
		format: format === '' ? undefined : format,
	};
}

function readNumberListFormat(listNode: RevisionStoreObject): string {
	const data = readData(listNode, Property.numberListFormat);
	if (!data || data.length < 2) return '';

	const value = new TextDecoder('utf-16le').decode(data.subarray(0, data.length - (data.length % 2)));
	if (value.length === 0) return '';

	return value.slice(1, 1 + Math.min(value.charCodeAt(0), value.length - 1));
}

function buildTable(
	context: MapContext,
	item: RevisionStoreObject,
	depth: number,
	path: Set<string>,
): Table {
	const { space } = context;
	const table: Table = { kind: 'table', rows: [] };

	for (const rowId of readReferences(item, Property.elementChildNodes)) {
		const rowItem = space.getObject(rowId);
		if (rowItem?.jcid !== Jcid.tableRowNode) continue;

		const row: TableRow = { cells: [] };
		for (const cellId of readReferences(rowItem, Property.elementChildNodes)) {
			const cellItem = space.getObject(cellId);
			if (cellItem?.jcid !== Jcid.tableCellNode) continue;

			const children: Element[] = [];
			for (const childId of readReferences(cellItem, Property.elementChildNodes)) {
				const child = buildElement(context, childId, depth + 1, path);
				if (child) children.push(child);
			}
			row.cells.push({ children });
		}

		table.rows.push(row);
	}

	return table;
}

function buildInk({ space, options, recognition }: MapContext, container: RevisionStoreObject): Ink | undefined {
	const inkDataId = readReferences(container, Property.inkData)[0];
	if (!inkDataId) return undefined;

	const inkData = space.getObject(inkDataId);
	if (inkData?.jcid !== Jcid.inkDataNode) return undefined;

	const scaleX = readFloat(container, Property.inkScalingX) ?? 1;
	const scaleY = readFloat(container, Property.inkScalingY) ?? 1;

	const ink: Ink = { kind: 'ink', strokes: [] };
	const words: string[] = [];

	for (const strokeId of readReferences(inkData, Property.inkStrokes)) {
		const strokeObject = space.getObject(strokeId);
		if (strokeObject?.jcid !== Jcid.inkStrokeNode) continue;

		const stroke = decodeStroke(space, strokeObject, scaleX, scaleY, options);
		if (!stroke) continue;

		stroke.recognizedText = recognition.get(keyOf(strokeId));
		if (stroke.recognizedText) words.push(stroke.recognizedText);
		ink.strokes.push(stroke);
	}

	if (ink.strokes.length === 0) return undefined;
	if (words.length > 0) ink.recognizedText = words.join(' ');
	return ink;
}

function decodeStroke(
	space: MaterializedObjectSpace,
	source: RevisionStoreObject,
	scaleX: number,
	scaleY: number,
	options: ReaderOptions,
): InkStroke | undefined {
	const properties = space.getObject(readReferences(source, Property.inkStrokeProperties)[0]);
	if (properties?.jcid !== Jcid.strokePropertiesNode) return undefined;

	const pathData = readData(source, Property.inkPath);
	if (!pathData) return undefined;

	const dimensions = decodeDimensions(readData(properties, Property.inkDimensions));
	const xIndex = indexOfDimension(dimensions, InkDimensionId.x);
	const yIndex = indexOfDimension(dimensions, InkDimensionId.y);
	if (xIndex < 0 || yIndex < 0) return undefined;

	const values = decodeSignedVector(pathData, Math.min(options.maxInkPathValues, pathData.length * 8));
	if (values.length === 0 || values.length % dimensions.length !== 0) return undefined;

	const pointCount = values.length / dimensions.length;
	const xs = decodePacketValues(values, xIndex * pointCount, pointCount);
	const ys = decodePacketValues(values, yIndex * pointCount, pointCount);

	const points = new Array<{ x: number, y: number }>(pointCount);
	for (let index = 0; index < pointCount; index++) {
		points[index] = {
			x: xs[index] * scaleX / NATIVE_UNITS_PER_HALF_INCH,
			y: ys[index] * scaleY / NATIVE_UNITS_PER_HALF_INCH,
		};
	}

	const transparency = readUInt32Property(properties, Property.inkTransparency) ?? 0;

	return {
		points,
		color: decodeInkColor(readUInt32Property(properties, Property.inkColor)),
		width: Math.max(0.000001, (readFloat(properties, Property.inkWidth) ?? 1) * Math.abs(scaleX) / NATIVE_UNITS_PER_HALF_INCH),
		opacity: 1 - Math.min(255, transparency) / 255,
	};
}

function collectRecognition(space: MaterializedObjectSpace, pageNode: RevisionStoreObject): Map<string, string> {
	const recognition = new Map<string, string>();
	const rootId = readReferences(pageNode, Property.pageRecognizedTextContainer)[0];
	if (!rootId) return recognition;

	const visited = new Set<string>();
	const walk = (id: ExtendedGuid, depth: number): void => {
		if (depth > 8 || visited.has(keyOf(id))) return;
		visited.add(keyOf(id));

		const item = space.getObject(id);
		if (!item) return;

		if (item.jcid === Jcid.recognizedTextWord) {
			const [word] = decodeRecognitionAlternatives(readData(item, Property.recognizedText));
			const references = readData(item, Property.recognizedTextStrokeReferences);
			if (!word || !references) return;

			for (let offset = 0; offset + 20 <= references.length; offset += 20) {
				recognition.set(keyOf({ identifier: id.identifier, value: readUInt32(references, offset + 16), encodedLength: 17 }), word);
			}
			return;
		}

		for (const childId of readReferences(item, Property.recognizedTextChildNodes)) walk(childId, depth + 1);
	};

	walk(rootId, 0);
	return recognition;
}

function buildImage({ space, materializer }: MapContext, item: RevisionStoreObject): Image {
	const image: Image = {
		kind: 'image',
		fileName: readString(item, Property.imageFilename),
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

function buildEmbeddedFile({ space, materializer }: MapContext, item: RevisionStoreObject): EmbeddedFile {
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
		case 'ink':
			if (element.recognizedText) into.push(element.recognizedText);
			break;
		default:
			break;
	}
}
