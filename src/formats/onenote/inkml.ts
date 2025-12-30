/**
 * Converts InkML (Ink Markup Language) files to SVG format.
 */

const INKML_NAMESPACE = 'http://www.w3.org/2003/InkML';

/** Padding around the SVG content. */
const PADDING = 10;

interface BrushProperties {
	color: string;
	width: number;
	height: number;
	transparency: number;
}

interface TraceWithBrush {
	id: string;
	coords: number[][];
	brush: BrushProperties;
}

interface BoundingBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const DEFAULT_BRUSH: BrushProperties = {
	color: '#000000',
	width: 70,
	height: 70,
	transparency: 0,
};

/**
 * Clean InkML content by removing any trailing MIME boundary markers
 * and extracting just the XML portion.
 * @param inkmlContent - The raw InkML content which may include MIME boundaries
 * @returns Clean XML content ready for parsing
 */
function cleanInkmlContent(inkmlContent: string): string {
	// The InkML content from OneNote API may include MIME boundary markers
	// after the closing </inkml:ink> or </ink> tag. We need to strip these.

	// Find the closing ink tag (with or without namespace)
	const closingTagMatch = inkmlContent.match(/<\/(?:inkml:)?ink>/);
	if (closingTagMatch && closingTagMatch.index !== undefined) {
		// Return only the content up to and including the closing tag
		return inkmlContent.substring(0, closingTagMatch.index + closingTagMatch[0].length);
	}

	// If no closing tag found, return as-is and let the parser handle it
	return inkmlContent;
}

/** Helper to find elements with namespace fallback. */
function findElements(parent: Element | Document, localName: string): Element[] {
	// Try with namespace first
	let elements = Array.from(parent.getElementsByTagNameNS(INKML_NAMESPACE, localName));
	// Fall back to local name if namespace doesn't work
	if (elements.length === 0) {
		elements = Array.from(parent.getElementsByTagName(localName));
	}
	return elements;
};

/**
 * Parse brush definitions from the InkML document
 */
function parseBrushes(doc: Document): Map<string, BrushProperties> {
	const brushMap = new Map<string, BrushProperties>();

	const brushElements = findElements(doc, 'brush');
	for (const brushElement of brushElements) {
		const brushId = brushElement.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')
			|| brushElement.getAttribute('xml:id')
			|| brushElement.getAttribute('id');

		if (!brushId) continue;

		const brush: BrushProperties = { ...DEFAULT_BRUSH };

		const brushProperties = findElements(brushElement, 'brushProperty');
		for (const prop of brushProperties) {
			const name = prop.getAttribute('name');
			const value = prop.getAttribute('value');

			if (!name || value === null) continue;

			switch (name) {
				case 'color':
					brush.color = value;
					break;
				case 'width':
					brush.width = parseFloat(value);
					break;
				case 'height':
					brush.height = parseFloat(value);
					break;
				case 'transparency':
					brush.transparency = parseFloat(value);
					break;
			}
		}

		brushMap.set(brushId, brush);
	}

	return brushMap;
}

/**
 * Parse InkML content and extract trace data with brush information
 * @param inkmlContent - The raw InkML XML content as a string
 * @returns Array of traces with their brush properties
 */
function getTracesWithBrushes(inkmlContent: string): TraceWithBrush[] {
	const cleanedContent = cleanInkmlContent(inkmlContent);
	const parser = new DOMParser();
	const doc = parser.parseFromString(cleanedContent, 'text/xml');

	// Check for parse errors
	const parseError = doc.querySelector('parsererror');
	if (parseError) {
		throw new Error(`Failed to parse InkML: ${parseError.textContent}`);
	}

	// Parse brush definitions
	const brushMap = parseBrushes(doc);

	// Parse all trace elements
	const traceElements = findElements(doc, 'trace');
	const traces: TraceWithBrush[] = [];

	for (const traceTag of traceElements) {
		// Get trace ID
		const id = traceTag.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')
			|| traceTag.getAttribute('xml:id')
			|| traceTag.getAttribute('id')
			|| '0';

		// Get brush reference and look up brush properties
		let brushRef = traceTag.getAttribute('brushRef') || '';
		// Remove leading # if present
		if (brushRef.startsWith('#')) {
			brushRef = brushRef.substring(1);
		}
		const brush = brushMap.get(brushRef) || DEFAULT_BRUSH;

		// Parse coordinates
		const text = traceTag.textContent || '';
		const coords = text
			.replace(/\n/g, '')
			.split(',')
			.map(coord =>
				coord
					.trim()
					.split(' ')
					.filter(part => part.length > 0)
					.map(axisCoord => {
						const num = parseFloat(axisCoord);
						// If it's an integer, use as-is; otherwise multiply by 10000 (for precision)
						return Number.isInteger(num) ? Math.round(num) : Math.round(num * 10000);
					}))
			.filter(coord => coord.length >= 2); // Only keep valid coordinates with at least x,y

		traces.push({ id, coords, brush });
	}

	return traces;
}

/**
 * Get the bounding box of traces
 */
function getBoundingBox(traces: TraceWithBrush[]): BoundingBox {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const trace of traces) {
		for (const coord of trace.coords) {
			if (coord.length >= 2) {
				minX = Math.min(minX, coord[0]);
				minY = Math.min(minY, coord[1]);
				maxX = Math.max(maxX, coord[0]);
				maxY = Math.max(maxY, coord[1]);
			}
		}
	}

	return { minX, minY, maxX, maxY };
}

/**
 * Convert InkML content to SVG string.
 * @param inkmlContent - The raw InkML XML content as a string.
 * @returns SVG string representation of the ink data or null if no traces found.
 */
export function inkmlToSvg(inkmlContent: string): string | null {
	if (!inkmlContent || inkmlContent.trim().length === 0) {
		return null;
	}

	const traces = getTracesWithBrushes(inkmlContent);
	if (traces.length === 0) {
		return null;
	}

	const { minX, minY, maxX, maxY } = getBoundingBox(traces);

	// Calculate dimensions with padding
	const width = maxX - minX + PADDING * 2;
	const height = maxY - minY + PADDING * 2;

	// Build SVG paths
	const paths: string[] = [];

	for (const trace of traces) {
		if (trace.coords.length === 0) continue;

		const stroke = trace.brush.color;
		// Ignore the conversion from himetric to pixels. It seems to match best when used 1:1.
		const strokeWidth = trace.brush.width;
		const opacity = 1 - trace.brush.transparency;
		const opacityAttr = opacity < 1 ? ` opacity="${opacity.toFixed(2)}"` : '';

		if (trace.coords.length === 1) {
			// Single point - draw a small circle
			const x = trace.coords[0][0] - minX + PADDING;
			const y = trace.coords[0][1] - minY + PADDING;
			paths.push(`<circle cx="${x}" cy="${y}" r="${strokeWidth / 2}" fill="${stroke}"${opacityAttr}/>`);
		}
		else {
			// Multiple points - draw a path
			const pathData = trace.coords.map((coord: number[], index: number) => {
				const x = coord[0] - minX + PADDING;
				const y = coord[1] - minY + PADDING;
				return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
			}).join(' ');

			paths.push(`<path d="${pathData}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`);
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join('\n')}</svg>`;
}
