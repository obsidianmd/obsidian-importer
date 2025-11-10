import { isElement } from './dom-utils';
import { getAttributeProxy } from './get-attribute-proxy';
import { unescapeMarkdown } from './replace-code-block';

const markdownBlock = '\n```\n';

const codeBlockFlag = '-en-codeblock:true';
const reMonospaceFont =
	/\b(Courier|Mono|Consolas|Console|Inconsolata|Pitch|Monaco|monospace)\b/;

const deepestFont = (node: ChildNode): string | null | undefined => {
	if (!isElement(node)) {
		return null;
	}
	const children = node.childNodes;
	const numChildren = children.length;
	if (numChildren > 1) {
		return 'mixed';
	}
	if (numChildren === 1) {
		const font = deepestFont(children[0]);
		if (font) {
			return font;
		}
	}
	const nodeProxy = getAttributeProxy(node);
	if (node.tagName === 'FONT') {
		return nodeProxy.getNamedItem('face')?.value;
	}
	const style = nodeProxy.getNamedItem('style')?.value;
	if (style) {
		const match = style.match(/font-family:([^;]+)/);
		if (match) {
			return match[1];
		}
	}

	return null;
};

const isMonospaceCodeBlock = (node: Element): boolean => {
	const nodeProxy = getAttributeProxy(node);
	const style = nodeProxy.getNamedItem('style')?.value;
	if (style?.includes(codeBlockFlag)) {
		return true;
	}

	const font = deepestFont(node);

	return !!font && reMonospaceFont.test(font);
};
/*
export const monospaceCodeBlockRule = defineRule({
    filter: filterByNodeName('DIV'),
    replacement: (content, node) => {
        if (yarleOptions.monospaceIsCodeBlock && isMonospaceCodeBlock(node)) {
            return replaceMonospaceCodeBlock(content, node);
        }
    },
});
*/
export const replaceMonospaceCodeBlock = (content: string, node: HTMLElement): string => {
	if (isMonospaceCodeBlock(node)) {
		const previous = node.previousElementSibling;
		const previousIsBlock = previous?.tagName === node.tagName && isMonospaceCodeBlock(previous);
		const next = node.nextElementSibling;
		const nextIsBlock = next?.tagName === node.tagName && isMonospaceCodeBlock(next);
		if (previousIsBlock || nextIsBlock) {
			content = (previousIsBlock ? '\n' : markdownBlock) + content + (nextIsBlock ? '\n' : markdownBlock);

			return content;
		}

		content = unescapeMarkdown(content);

		return content.trim() ? `${markdownBlock}${content}${markdownBlock}` : content;
	}

	if (node.parentElement && isMonospaceCodeBlock(node.parentElement) && node.parentElement.firstElementChild === node) {
		return content;
	}

	if (node.parentElement && isMonospaceCodeBlock(node.parentElement)) {
		return `\n${content}`;
	}

	return node.isBlock ? `\n${content}\n` : content;
};
