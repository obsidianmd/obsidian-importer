import { TurndownNode } from './turndown-types';

import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';

const getImageSize = (nodeProxy: Record<string, { value: string } | undefined>): string => {
	const width = pixels(nodeProxy.width?.value);
	if (!width) return '';

	const height = pixels(nodeProxy.height?.value);

	return height ? `|${width}x${height}` : `|${width}`;
};

const pixels = (measure: string | undefined): number => {
	const size = Number.parseFloat(measure ?? '');

	return Number.isFinite(size) && size >= 1 ? Math.round(size) : 0;
};

export const imagesRule = {
	filter: filterByNodeName('IMG'),
	replacement: (content: string, node: TurndownNode) => {
		const nodeProxy = getAttributeProxy(node);

		if (!nodeProxy.src) {
			return '';
		}
		const value = nodeProxy.src.value;
		const size = getImageSize(nodeProxy);

		if (!value.match(/^[a-z]+:/)) {
			return `![[${value}${size}]]`;
		}

		const srcSpl = value.split('/');

		return `![${srcSpl[srcSpl.length - 1]}${size}](${value})`;
	},
};
