import { TurndownNode } from './turndown-types';
import { evernoteOptions } from '../../convert';

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
		const image = node.instanceOf(HTMLImageElement) ? node : undefined;
		const widthParam = image?.width || '';
		const heightParam = image?.height || '';
		let realValue = value;
		if (evernoteOptions.sanitizeResourceNameSpaces) {
			realValue = realValue.replace(/ /g, evernoteOptions.replacementChar);
		}
		else if (evernoteOptions.urlEncodeFileNamesAndLinks) {
			realValue = encodeURI(realValue);
		}
		let sizeString = (widthParam || heightParam) ? ` =${widthParam}x${heightParam}` : '';

		// while this isn't really a standard, it is common enough
		if (evernoteOptions.keepImageSize) {
			sizeString = (widthParam || heightParam) ? `|${widthParam || 0}x${heightParam || 0}` : '';
			if (realValue.startsWith('./')) {
				return `![[${realValue}${sizeString}]]`;
			}
			else {
				return `![${sizeString}](${realValue})`;
			}
		}

		if (!value.match(/^[a-z]+:/)) {
			return `![[${realValue}]]`;
		}

		const srcSpl = nodeProxy.src.value.split('/');

		return `![${srcSpl[srcSpl.length - 1]}](${realValue})`;
	},
};
