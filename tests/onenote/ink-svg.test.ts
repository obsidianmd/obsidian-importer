import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strokesToSvg } from '../../src/formats/onenote/ink-svg';

test('draws a page with more strokes than a function takes arguments', () => {
	const strokes = Array.from({ length: 200_000 }, () => ({ points: [{ x: 0, y: 0 }], color: '#000000', width: 1, opacity: 1 }));
	assert.ok(strokesToSvg(strokes)?.startsWith('<svg'));
});
