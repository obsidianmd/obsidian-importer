import { strokesToSvg } from '../onenote/ink-svg';
import { SamsungStroke } from './parse';

/**
 * Line width as a share of the stored pen size, measured against Samsung's own
 * PDF export. Samsung varies a pen's width with pressure and speed, so a
 * fountain pen's average comes out near half its size; a highlighter, like a
 * shape's line, draws at its full size.
 */
const PEN_WIDTH = 0.45;
const HIGHLIGHTER_WIDTH = 1;

/** A page's strokes as an SVG, with highlighters beneath ink as Samsung Notes draws them. */
export function drawingToSvg(strokes: SamsungStroke[]): string | null {
	const translucent = (stroke: SamsungStroke) => alpha(stroke) < 255;
	const ordered = [...strokes.filter(translucent), ...strokes.filter(stroke => !translucent(stroke))];

	return strokesToSvg(ordered.map(stroke => ({
		points: stroke.points.filter((point, i, all) => i === 0 || point.x !== all[i - 1].x || point.y !== all[i - 1].y),
		color: '#' + (stroke.color & 0xFFFFFF).toString(16).padStart(6, '0'),
		width: stroke.kind === 'shape' ? stroke.size : stroke.size * (translucent(stroke) ? HIGHLIGHTER_WIDTH : PEN_WIDTH),
		opacity: alpha(stroke) / 255,
	})));
}

function alpha(stroke: SamsungStroke): number {
	return stroke.color >>> 24;
}
