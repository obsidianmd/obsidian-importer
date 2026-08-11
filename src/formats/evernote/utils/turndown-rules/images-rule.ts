import { TurndownNode } from './turndown-types';

import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';

export const imagesRule = {
	filter: filterByNodeName('IMG'),
	replacement: (content: string, node: TurndownNode) => {
		const nodeProxy = getAttributeProxy(node);

		if (!nodeProxy.src) {
			return '';
		}
		const value = nodeProxy.src.value;

		if (!value.match(/^[a-z]+:/)) {
			return `![[${value}]]`;
		}

		const srcSpl = value.split('/');

		return `![${srcSpl[srcSpl.length - 1]}](${value})`;
	},
};
