import { genUid } from '../../../../util';
import { RuntimePropertiesSingleton } from '../../runtime-properties';
import { yarleOptions } from '../../yarle';

import { normalizeTitle } from '../filename-utils';
import { getTurndownService } from '../turndown-service';
import { isTOC } from '../is-toc';

import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';
import { defineRule } from './define-rule';

export const removeBrackets = (str: string): string => {
	return str.replace(/\[|\]/g, '');
};
export const removeDoubleBackSlashes = (str: string): string => {
	return str.replace(/\\/g, '');
};
export const wikiStyleLinksRule = defineRule({
	filter: filterByNodeName('A'),
	replacement: (content, node) => {
		const nodeProxy = getAttributeProxy(node);

		const href = nodeProxy.getNamedItem('href');
		if (!href) {
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

		const value = href.value;
		const type = nodeProxy.getNamedItem('type')?.value;
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
});


const htmlUnescapes: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': '\'',
};

const reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g;
const reHasEscapedHtml = RegExp(reEscapedHtml.source);

function unescape(text: string) {
	return (text && reHasEscapedHtml.test(text))
		? text.replace(reEscapedHtml, (str: string) => htmlUnescapes[str])
		: text;
}

export const getShortLinkIfPossible = (text: string, value: string): string =>
	text && unescape(text) !== unescape(value)
		? `[${text}](${value})`
		: yarleOptions.generateNakedUrls
			? value
			: `<${value}>`;
