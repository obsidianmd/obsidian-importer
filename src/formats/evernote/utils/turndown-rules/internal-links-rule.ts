import { TurndownNode } from './turndown-types';
import { EvernoteRun } from '../../run';

import { normalizeTitle } from '../filename-utils';
import { isNormalMarkdownHref } from '../link-hrefs';
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
export const wikiStyleLinksRule = (run: EvernoteRun) => ({
	filter: filterByNodeName('A'),
	replacement: (content: string, node: TurndownNode) => {
		const nodeProxy = getAttributeProxy(node);

		if (!nodeProxy.href) {
			return '';
		}
		let text: string = getTurndownService(run).turndown(removeBrackets(node.innerHTML));
		text = removeDoubleBackSlashes(text);
		let prefix = '';
		let match = text.match(/^(#{1,6} )(.*)/);
		if (match) {
			prefix = match[1];
			text = match[2];
		}

		const value = nodeProxy.href.value;
		const type = nodeProxy.type ? nodeProxy.type.value : undefined;
		if (type === 'file') {
			return `![[${value}]]`;
		}
		if (value.startsWith('evernote://')) {
			// A link resolves by the title it shows, so an anchor showing the URL or
			// nothing at all would be sanitized into an invented one.
			const shown = text.trim();
			if (!shown || shown.startsWith('evernote://')) {
				return prefix + `<${value}>`;
			}

			const fileName = normalizeTitle(text);
			const noteIdNameMap = run.properties;
			if (isTOC(noteIdNameMap.getCurrentNoteName())) {
				noteIdNameMap.addItemToTOCMap({ url: value, title: fileName });
			}
			else {
				noteIdNameMap.addItemToMap({ url: value, title: fileName });
			}

			return prefix + `[[${value}]]`;
		}
		if (isNormalMarkdownHref(value)) {
			return prefix + getShortLinkIfPossible(text, value);
		}

		return prefix + `[[${value}${text === value ? '' : `|${text}`}]]`;
	},
});


let htmlUnescapes: Record<string, string> = {
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
	return (!text || unescape(text) === unescape(value)) ? `<${value}>` : `[${text}](${value})`;
};
