import { genUid } from '../../../../util';
import { RuntimePropertiesSingleton } from '../../runtime-properties';
import { yarleOptions } from '../../yarle';

import { normalizeTitle } from '../filename-utils';
import { getTurndownService } from '../turndown-service';
import { isTOC } from '../is-toc';

import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';

export const removeBrackets = (str: string): string => {
	return str.replace(/\[|\]/g, '');
};
export const removeDoubleBackSlashes = (str: string): string => {
	return str.replace(/\\/g, '');
};
export const wikiStyleLinksRule = {
	filter: filterByNodeName('A'),
	replacement: (content: any, node: any) => {
		const nodeProxy = getAttributeProxy(node);

		if (!nodeProxy.href) {
			return '';
		}
		let text = getTurndownService(yarleOptions).turndown(removeBrackets(node.innerHTML));
		text = removeDoubleBackSlashes(text);
		let prefix = '';
		let match = text.match(/^(#{1,6} )(.*)/);
		if (match) {
			prefix = match[1];
			text = match[2];
		}

		const value = nodeProxy.href.value;
		const type = nodeProxy.type ? nodeProxy.type.value : undefined;
		const realValue = yarleOptions.urlEncodeFileNamesAndLinks ? encodeURI(value) : value;

		if (type === 'file') {
			return `![[${realValue}]]`;
		}
		if (value.match(/^(https?:|www\.|file:|ftp:|mailto:)/)) {
			return prefix + getShortLinkIfPossible(text, value);
		}

		if (value.startsWith('evernote://')) {
			const fileName = normalizeTitle(text);
			const noteIdNameMap = RuntimePropertiesSingleton.getInstance();
			const uniqueId = genUid(6);
			if (isTOC(noteIdNameMap.getCurrentNoteName())) {
				noteIdNameMap.addItemToTOCMap({ url: value, title: fileName, uniqueEnd: uniqueId });
			}
			else {
				noteIdNameMap.addItemToMap({ url: value, title: fileName, uniqueEnd: uniqueId });
			}

			return prefix + `[[${value}]]`;
		}

		return prefix + `[[${realValue}${text === realValue ? '' : `|${text}`}]]`;
	},
};


let htmlUnescapes: any = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': '\'',
};

let reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g;
let reHasEscapedHtml = RegExp(reEscapedHtml.source);

function unescape(text: string) {
	return (text && reHasEscapedHtml.test(text))
		? text.replace(reEscapedHtml, (str: string) => htmlUnescapes[str])
		: text;
}

export const getShortLinkIfPossible = (text: string, value: string): string => {
	return (!text || unescape(text) === unescape(value)) ? yarleOptions.generateNakedUrls ? value : `<${value}>` : `[${text}](${value})`;
};
