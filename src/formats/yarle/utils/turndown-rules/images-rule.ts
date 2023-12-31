import { yarleOptions } from '../../yarle';

import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';

export const imagesRule = {
	filter: filterByNodeName('IMG'),
	replacement: (content: any, node: any) => {
		const nodeProxy = getAttributeProxy(node);

		if (!nodeProxy.src) {
			return '';
		}
		const value = nodeProxy.src.value;
		const widthParam = node.width || '';
		const heightParam = node.height || '';
		let realValue = value;
		if (yarleOptions.sanitizeResourceNameSpaces) {
			realValue = realValue.replace(/ /g, yarleOptions.replacementChar);
		}
		else if (yarleOptions.urlEncodeFileNamesAndLinks) {
			realValue = encodeURI(realValue);
		}
		let sizeString = (widthParam || heightParam) ? ` =${widthParam}x${heightParam}` : '';

		// while this isn't really a standard, it is common enough
		if (yarleOptions.keepImageSize) {
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
