const PADDING = 10;

export interface SvgStrokePoint {
	x: number;
	y: number;
}

export interface SvgStroke {
	points: SvgStrokePoint[];
	color: string;
	width: number;
	opacity: number;
}

export function strokesToSvg(strokes: SvgStroke[]): string | null {
	const drawable = strokes.filter(stroke => stroke.points.length > 0);
	if (drawable.length === 0) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const stroke of drawable) {
		for (const point of stroke.points) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
	}

	const width = maxX - minX + PADDING * 2;
	const height = maxY - minY + PADDING * 2;
	const paths: string[] = [];

	for (const stroke of drawable) {
		const opacityAttr = stroke.opacity < 1 ? ` opacity="${stroke.opacity.toFixed(2)}"` : '';

		if (stroke.points.length === 1) {
			const { x, y } = stroke.points[0];
			paths.push(`<circle cx="${x - minX + PADDING}" cy="${y - minY + PADDING}" r="${stroke.width / 2}" fill="${stroke.color}"${opacityAttr}/>`);
			continue;
		}

		const pathData = stroke.points
			.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x - minX + PADDING} ${point.y - minY + PADDING}`)
			.join(' ');

		paths.push(`<path d="${pathData}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join('\n')}</svg>`;
}
