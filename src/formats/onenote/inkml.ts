// @ts-nocheck
// DO NOT REVIEW THIS FILE. IT IS NOT READY TO USE
/**
 * Reimplementation of the InkML.js library in TypeScript, used by Microsoft for OneNote notes.
 * This version has the exact same rendering with the original library, but without jQuery
 * and includes TypeScript type annotations for improved code readability and maintainability.
 * Drawing features are removed, as those are simply useless for most usecases including ours (you're better off with another library for this)
 *
 * TODO: Implement some extra things from the InkML XML such as rainbow/glitter pens
 * 
 * Link to the original library: https://github.com/microsoft/InkMLjs
 */

//DPI for converting ink space (himetric) to pixels
const G_DPI = 150;
//XML namespaces
const c_inkmlNS = 'http://www.w3.org/2003/InkML';
const c_xmlNS = 'http://www.w3.org/XML/1998/namespace';
const c_xmlnsNS = 'http://www.w3.org/2000/xmlns/';
const HI_METRIC_PER_UNIT =
{
	'm': 100000,
	'cm': 1000,
	'mm': 100,
	'in': 2540,
	'pt': 35.27778,
	'pc': 424.3333,
};

// Ink class
export default class Ink {
	private contexts: Record<string, InkContext> = {};
	private brushes: Record<string, InkBrush> = {};
	private traces: Record<string, InkTrace> = {};
	private mins: number[] = [];
	private maxs: number[] = [];
	private sums: number[] = [];
	private count = 0;

	private deltas: number[] = [];
	private ctx: CanvasRenderingContext2D | null = null;
	private canvas: HTMLCanvasElement;

	constructor(inkMLDocument: XMLDocument, canvas: HTMLCanvasElement) {
		this.canvas = canvas;

		const contextElements = inkMLDocument?.querySelectorAll('inkml\\:context, context');

		contextElements?.forEach((contextElement) => {
			const id = contextElement.getAttribute('xml:id');
			if (id) {
				const context = new InkContext(contextElement);
				this.contexts[id] = context;
			}
		});

		const brushes = document.getElementsByTagNameNS(c_inkmlNS, 'brush');

		for (const brushElement of brushes) {
			const brush = new InkBrush(brushElement);
			let id = brushElement.getAttribute('xml:id');

			if (!id || id === '') {
				const count = Object.keys(this.brushes).length;
				id = 'brush#' + count.toString();
			}

			this.brushes['#' + id] = brush;
		}

		// iterate over the traces
		inkMLDocument.querySelectorAll('inkml\\:trace, trace').forEach((el) => {
			let trace = new InkTrace(this, el);
			let id = el.getAttribute('xml:id');
			id = '#' + id;
			this.traces[id] = trace;
		});
	}

	clear() {
		if (!this.canvas.getContext) {
			console.error('InkML error: couldn\'t get context on canvas');
			return;
		}

		const ctx = this.canvas.getContext('2d');
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	draw(canvas: HTMLCanvasElement, ignorePressure: boolean) {
		if (!canvas.getContext) {
			alert('error: couldn\'t get context on canvas');
			return;
		}

		const ctx = canvas.getContext('2d');

		Object.entries(this.traces).forEach(([id, trace]) => {
			ctx.save();

			const context = this.contexts['ctxCoordinatesWithPressure'];//const context = this.contexts[trace.contextRef];
			ctx.scale(context.xFactor, context.xFactor);

			const brush = this.getBrushForTrace(trace, context);

			if (brush !== null) {
				this.applyBrushSettings(ctx, brush);
			}

			ctx.beginPath();
			for (let i = 0; i < trace.value.length; i++) {
				if (i === 0) {
					if (ignorePressure) {
						const [x, y] = this.adjustCoordinates(trace.value[i]);
						ctx.moveTo(x, y);
					}
				}
				else {
					if (ignorePressure) {
						const [x, y] = this.adjustCoordinates(trace.value[i]);
						ctx.lineTo(x, y);
					}
					else {
						const [x1, y1] = this.adjustCoordinates(trace.value[i - 1]);
						const [x2, y2] = this.adjustCoordinates(trace.value[i]);
						if (brush) {
							const width = brush.width;
							const force = (trace.value[i - 1][2] + trace.value[i][2]) / 2;
							if (force) {
								const avg = this.sums[2] / this.count;
								const adjustedForce = this.calculateAdjustedForce(force, context);
								const pixelWidth = this.calculatePixelWidth(width, adjustedForce);
								ctx.lineWidth = pixelWidth * 10;
							}
							ctx.moveTo(x1, y1);
							ctx.lineTo(x2, y2);
							ctx.stroke();
						}
					}
				}
			}
			if (ignorePressure) {
				ctx.stroke();
			}
			ctx.restore();
		});
	}

	private getBrushForTrace(trace: InkTrace, context: InkContext): InkBrush | null {
		let brush = null;
		if (trace.brushRef !== null) {
			brush = this.brushes[trace.brushRef];
			if (brush === null) {
				alert(`error: brush with xml:id='${trace.brushRef}' not found.`);
			}
		}
		else if (context.brush) {
			brush = context.brush;
		}
		return brush;
	}

	private applyBrushSettings(ctx: CanvasRenderingContext2D, brush: InkBrush) {
		ctx.strokeStyle = brush.color;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		const pixelWidth = this.calculatePixelWidth(brush.width, G_DPI);
		ctx.lineWidth = pixelWidth * 10;
	}

	private adjustCoordinates(coords: number[]): number[] {
		const adjustedX = coords[0] - this.mins[0];
		const adjustedY = coords[1] - this.mins[1];
		return [adjustedX, adjustedY];
	}

	private calculateAdjustedForce(force: number, context: InkContext): number {
		const adjustedForce = force - context.fNeutral;
		return adjustedForce * context.fFactor;
	}

	private calculatePixelWidth(width: number, force: number): number {
		return HiMetricToPixel(width + width * force, G_DPI);
	}
}

class InkContext {
	inkSource: InkSource | null = null;
	brush: InkBrush | null = null;
	timestamp: InkTimestamp | null = null;
	xFactor = 1;
	yFactor = 1;
	fFactor = 1;
	fNeutral = 0.5;

	constructor(inkMLContext: Element) {
		const inkmlInkSource = Array.from(inkMLContext.getElementsByTagNameNS(c_inkmlNS, 'inkSource'));
		if (inkmlInkSource.length) {
			this.inkSource = new InkSource(inkmlInkSource[0]);

			const xChan = this.inkSource.traceFormat.channels['X'];
			const yChan = this.inkSource.traceFormat.channels['Y'];

			const xRes = UnitsToHiMetric(1 / xChan.resolution, xChan.units);
			const yRes = UnitsToHiMetric(1 / yChan.resolution, yChan.units);
			this.xFactor = HiMetricToPixel(xRes, G_DPI);
			this.yFactor = HiMetricToPixel(yRes, G_DPI);

			const fChan = this.inkSource.traceFormat.channels['F'];
			if (fChan) {
				this.fFactor = 1 / (fChan.max - fChan.min);
				this.fNeutral = (fChan.max + fChan.min) / 2;
			}
		}

		const inkmlBrush = inkMLContext.querySelectorAll('inkml\\:brush, brush');
		if (inkmlBrush.length) {
			this.brush = new InkBrush(inkmlBrush[0]); // Assuming you only want to use the first brush
		}

		const inkmlTimestamp = inkMLContext.querySelectorAll('inkml\\:timestamp, timestamp');
		if (inkmlTimestamp.length) {
			this.timestamp = new InkTimestamp(inkmlTimestamp[0]); // Assuming you only want to use the first timestamp
		}
	}
}

class InkTimestamp {
	id: string | null = null;
	timeString: string | null = null;

	constructor(inkmlTimestamp: Element) {
		this.id = inkmlTimestamp.getAttribute('xml:id') || inkmlTimestamp.getAttribute('id');
		this.timeString = inkmlTimestamp.getAttribute('timeString');
	}
}

class InkSource {
	id: string | null = null;
	traceFormat: InkTraceFormat | null = null;
	channelProperties: InkChannelProperty[] = [];
	channels: Record<string, InkChannel> = {}; // Initialize the channels property

	constructor(inkmlInkSource: Element) {
		this.id = inkmlInkSource.getAttribute('xml:id') || inkmlInkSource.getAttribute('id');
		this.traceFormat = null;
		this.channelProperties = [];
		this.channels = {}; // Initialize the channels property

		const inkmlTraceFormat = inkmlInkSource.querySelector('inkml\\:traceFormat, traceFormat');
		if (!inkmlTraceFormat) {
			alert('error: traceFormat is required on inkSource');
		}

		const inkmlChannelProperties = inkmlInkSource.querySelectorAll('inkml\\:channelProperties, channelProperties');

		this.traceFormat = new InkTraceFormat(inkmlTraceFormat, inkmlChannelProperties);

		// Iterate over the channelProperties
		Array.from(inkmlInkSource.querySelectorAll('inkml\\:channelProperty, channelProperty')).forEach(channelPropertyElement => {
			const channelProperty = new InkChannelProperty(channelPropertyElement);
			this.channelProperties.push(channelProperty);
		});
	}
}

class InkTraceFormat {
	channels: Record<string, InkChannel> = {};
	id: string | null = null;

	constructor(inkmlTraceFormat: Element, inkmlChannelProperties: NodeListOf<Element>) {
		this.id = inkmlTraceFormat.getAttribute('xml:id') || inkmlTraceFormat.getAttribute('id');
		this.channels = {};

		// iterate over the channels
		Array.from(inkmlTraceFormat.querySelectorAll('inkml\\:channel, channel')).forEach(channelElement => {
			const name = channelElement.getAttribute('name');
			const channel = new InkChannel(channelElement, inkmlChannelProperties);
			this.channels[name] = channel;
		});
	}
}

class InkChannel {
	name: string;
	type: string;
	min: number;
	max: number;
	units: string;
	resolution: number;

	constructor(inkmlChannel: Element, inkmlChannelProperties: NodeListOf<Element>) {
		this.name = inkmlChannel.getAttribute('name') || '';
		this.type = inkmlChannel.getAttribute('type') || '';
		this.min = parseFloat(inkmlChannel.getAttribute('min') || '0');
		this.max = parseFloat(inkmlChannel.getAttribute('max') || '0');
		this.units = inkmlChannel.getAttribute('units') || '';
		this.resolution = 0;

		const resPropArray = Array.from(inkmlChannelProperties).find(property => {
			const propertyChannel = property.getAttribute('channel');
			return propertyChannel === this.name && property.getAttribute('name') === 'resolution';
		});
        
		if (resPropArray) {
			const resProp = resPropArray as Element;
			if (resProp) {
				const value = parseFloat(resProp.getAttribute('value') || '0');
				const units = resProp.getAttribute('units') || '';
				if (units.startsWith('1/')) {
					const unitChannel = units.substring(2);
					if (this.units !== unitChannel) {
						alert('error: units of resolution property expected to be same as channel');
					}
					this.resolution = value;
				}
				else {
					alert('error: units of resolution property expected to be 1/unit');
				}
			}
		}
        

	}
}

class InkChannelProperty {
	name: string;
	channel: string;
	value: number;
	units: string;

	constructor(inkmlChannelProperty: Element) {
		this.channel = inkmlChannelProperty.getAttribute('channel') || '';
		this.name = inkmlChannelProperty.getAttribute('name') || '';
		this.value = parseFloat(inkmlChannelProperty.getAttribute('value') || '0');
		this.units = inkmlChannelProperty.getAttribute('units') || '';
	}
}

class InkBrush {
	width: number;
	color: string;
	brushProperties: Record<string, InkBrushProperty>;

	constructor(inkmlBrush: Element) {
		this.width = 10;
		this.color = '#000000';
		this.brushProperties = {};

		const brushProperties = inkmlBrush.querySelectorAll('inkml\\:brushProperty, brushProperty');
		for (const brushPropertyElement of brushProperties) {
			const name = brushPropertyElement.getAttribute('name');
			switch (name) {
				case 'color':
					this.color = brushPropertyElement.getAttribute('value') || this.color;
					break;
				case 'width':
					const widthValue = parseFloat(brushPropertyElement.getAttribute('value') || '0');
					const widthUnits = brushPropertyElement.getAttribute('units') || '';
					this.width = UnitsToHiMetric(widthValue, widthUnits);
					break;
				default:
					break;
			}

			const brushProperty = new InkBrushProperty(brushPropertyElement);
			this.brushProperties[name] = brushProperty;
		}
	}
}

class InkBrushProperty {
	name: string;
	value: any;
	units: string;

	constructor(inkmlBrushProperty: Element) {
		this.name = inkmlBrushProperty.getAttribute('name') || '';
		this.value = inkmlBrushProperty.getAttribute('value') || '';
		this.units = inkmlBrushProperty.getAttribute('units') || '';
	}
}

class InkTrace {
	ink: any;
	value: number[][];
	deriv: string[][];
	brushRef: string;
	contextRef: string;
	timeOffset: string;

	constructor(ink: any, inkmlTrace: Element) {
		this.ink = ink;
		this.value = [];
		this.deriv = [];
		this.brushRef = inkmlTrace.getAttribute('brushRef') || '';
		this.contextRef = inkmlTrace.getAttribute('contextRef') || '';
		this.timeOffset = inkmlTrace.getAttribute('timeOffset') || '';
		this.parseTrace(inkmlTrace.textContent || '');
		this.computeDerivatives();
		//this.updateInkStats(); TODO: remove or fix the function ;)
	}

	private parseTrace(trace: string): void {
		const packets = trace.split(',');
		let thisDeriv = '!';

		for (const packet of packets) {
			const values: number[] = [];
			const derivatives: string[] = [];
			let thisValue = '';

			for (const ch of packet) {
				if (isDigit(ch)) {
					thisValue += ch;
				}
				else {
					if (thisValue.length > 0) {
						values.push(parseFloat(thisValue));
						derivatives.push(thisDeriv);
						if (ch === '-') {
							thisValue = ch;
						}
						else if (this.isDerivativeSymbol(ch)) {
							thisValue = '';
							thisDeriv = ch;
						}
						else {
							thisValue = '';
						}
					}
					else {
						if (ch === '-') {
							thisValue = ch;
						}
						else if (this.isDerivativeSymbol(ch)) {
							thisDeriv = ch;
						}
					}
				}
			}

			if (thisValue.length > 0) {
				values.push(parseFloat(thisValue));
				derivatives.push(thisDeriv);
			}

			this.value.push(values);
			this.deriv.push(derivatives);
		}
	}

	private computeDerivatives(): void {
		const deltas: number[] = [];

		for (let i = 0; i < this.value.length; i++) {
			for (let j = 0; j < this.value[i].length; j++) {
				if (this.deriv[i][j] === '\'') {
					deltas[j] = this.value[i][j];
					this.value[i][j] = this.value[i - 1][j] + deltas[j];
				}
				else if (this.deriv[i][j] === '"') {
					deltas[j] += this.value[i][j];
					this.value[i][j] = this.value[i - 1][j] + deltas[j];
				}
			}
		}
	}

	private updateInkStats(): void {
		console.log(this.ink);
		for (let i = 0; i < this.value.length; i++) {
			for (let j = 0; j < this.value[i].length; j++) {
				const val = this.value[i][j];

				if (this.ink.mins.length <= j) {
					this.ink.mins.push(val);
				}
				else if (this.ink.mins[j] > val) {
					this.ink.mins[j] = val;
				}

				if (this.ink.maxs.length <= j) {
					this.ink.maxs.push(val);
				}
				else if (this.ink.maxs[j] < val) {
					this.ink.maxs[j] = val;
				}

				if (this.ink.sums.length <= j) {
					this.ink.sums.push(val);
					this.ink.count++;
				}
				else {
					this.ink.sums[j] += val;
					this.ink.count++;
				}
			}
		}
	}

	private isDerivativeSymbol(ch: string): boolean {
		return ch === '\'' || ch === '"' || ch === '!';
	}
}

// Legacy utilities, ported directly from InkML.js
function isDigit(ch: string): boolean {
	return /[0-9.]/.test(ch);
}

function HiMetricToUnits(value: number, units: string): number {
	const factor = HI_METRIC_PER_UNIT[units];
	if (factor == null) {
		return value;
	}
	const result = value * (1 / factor);
	return result;
}

function UnitsToHiMetric(value: number, units: string): number {
	const factor = HI_METRIC_PER_UNIT[units];
	if (factor == null) {
		return value;
	}
	const result = value * factor;
	return result;
}

function PixelToHiMetric(pixel: number, dpi: number): number {
	const himetric = (pixel * 2540) / dpi;
	return himetric;
}

function HiMetricToPixel(himetric: number, dpi: number): number {
	const pixel = (himetric * dpi) / 2540;
	return pixel;
}
