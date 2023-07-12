import { marked } from 'marked';
import { RuntimePropertiesSingleton } from '../../runtime-properties';
import { yarleOptions } from '../../yarle';

import { getUniqueId, normalizeTitle } from '../filename-utils';
import { getTurndownService } from '../turndown-service';
import { isTOC } from './../../utils/is-toc';

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
		let internalTurndownedContent =
			getTurndownService(yarleOptions).turndown(removeBrackets(node.innerHTML));
		internalTurndownedContent = removeDoubleBackSlashes(internalTurndownedContent);
		const lexer = new marked.Lexer({});
		const tokens = lexer.lex(internalTurndownedContent) as any;
		const extension = yarleOptions.addExtensionToInternalLinks ? '.md' : '';
		let token: any = {
			mdKeyword: '',
			text: internalTurndownedContent,
		};
		if (tokens.length > 0 && tokens[0]['type'] === 'heading') {
			token = tokens[0];
			token['mdKeyword'] = `${'#'.repeat(tokens[0]['depth'])} `;
		}
		const value = nodeProxy.href.value;
		const type = nodeProxy.type ? nodeProxy.type.value : undefined;
		const realValue = yarleOptions.urlEncodeFileNamesAndLinks ? encodeURI(value) : value;

		if (type === 'file') {
			return `![[${realValue}]]`;
		}
		if (value.match(/^(https?:|www\.|file:|ftp:|mailto:)/)) {
			return getShortLinkIfPossible(token, value);
		}

		const displayName = token['text'];
		const mdKeyword = token['mdKeyword'];

		// handle ObsidianMD internal link display name
		const omitObsidianLinksDisplayName = yarleOptions.obsidianSettings.omitLinkDisplayName;
		const renderedObsidianDisplayName = omitObsidianLinksDisplayName ? '' : `|${displayName}`;

		if (value.startsWith('evernote://')) {
			const fileName = normalizeTitle(token['text']);
			const noteIdNameMap = RuntimePropertiesSingleton.getInstance();
			const uniqueId = getUniqueId();
			if (isTOC(noteIdNameMap.getCurrentNoteName())) {
				noteIdNameMap.addItemToTOCMap({ url: value, title: fileName, uniqueEnd: uniqueId });
			}
			else {
				noteIdNameMap.addItemToMap({ url: value, title: fileName, uniqueEnd: uniqueId });
			}

			return `${mdKeyword}[[${value}${extension}${renderedObsidianDisplayName}]]`;
		}

		return `${mdKeyword}[[${realValue}${renderedObsidianDisplayName}]]`;
	},
};


let htmlUnescapes: any = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': '\''
};

let reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g;
let reHasEscapedHtml = RegExp(reEscapedHtml.source);

function unescape(text: string) {
	return (text && reHasEscapedHtml.test(text))
		? text.replace(reEscapedHtml, (str: string) => htmlUnescapes[str])
		: text;
}

export const getShortLinkIfPossible = (token: any, value: string): string => {
	return (!token['text'] || unescape(token['text']) === unescape(value))
		? yarleOptions.generateNakedUrls ? value : `<${value}>`
		: `${token['mdKeyword']}[${token['text']}](${value})`;
};
