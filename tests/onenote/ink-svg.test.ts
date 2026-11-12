import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strokesToSvg } from '../../src/formats/onenote/ink-svg';

test('draws a page with more strokes than a function takes arguments', () => {
	const strokes = Array.from({ length: 200_000 }, () => ({ points: [{ x: 0, y: 0 }], color: '#000000', width: 1, opacity: 1 }));
	assert.ok(strokesToSvg(strokes)?.startsWith('<svg'));
});

test('a stroke without a usable width leaves the rest of the drawing in place', () => {
	const svg = strokesToSvg([
		{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#000000', width: NaN, opacity: 1 },
		{ points: [{ x: 5, y: 5 }, { x: 20, y: 20 }], color: '#000000', width: 2, opacity: 1 },
	])!;
	assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"'), svg.slice(0, 120));
});

