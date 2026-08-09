import { TurndownNode } from './turndown-types';
import { getAttributeProxy } from './get-attribute-proxy';
import { unescapeMarkdown } from './replace-code-block';

const markdownBlock = '\n```\n';

const codeBlockFlag = '-en-codeblock:true';
const reMonospaceFont =
	/\b(Courier|Mono|Consolas|Console|Inconsolata|Pitch|Monaco|monospace)\b/;

const asElement = (node: ChildNode | null): TurndownNode | null =>
	node?.instanceOf(HTMLElement) ? node : null;

const deepestFont: (node: ChildNode) => string | null | undefined = node => {
	const el = asElement(node);
	if (!el) {
		return null;
	}
	const children = el.childNodes;
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
	const nodeProxy = getAttributeProxy(el);
	if (el.tagName === 'FONT') {
		return nodeProxy.face?.value;
	}
	const style = nodeProxy.style?.value;
	if (style) {
		const match = style.match(/font-family:([^;]+)/);
		if (match) {
			return match[1];
		}
	}

	return null;
};

const isMonospaceCodeBlock: (node: TurndownNode) => boolean = node => {
	const nodeProxy = getAttributeProxy(node);
	const style = nodeProxy.style?.value;
	if (style && style.includes(codeBlockFlag)) {
		return true;
	}

	const font = deepestFont(node);

	return !!font && reMonospaceFont.test(font);
};
export const replaceMonospaceCodeBlock = (content: string, node: TurndownNode): string => {
	if (isMonospaceCodeBlock(node)) {
		const previous = asElement(node.previousSibling);
		const previousIsBlock = previous && previous.tagName === node.tagName && isMonospaceCodeBlock(previous);
		const next = asElement(node.nextSibling);
		const nextIsBlock = next && next.tagName === node.tagName && isMonospaceCodeBlock(next);
		if (previousIsBlock || nextIsBlock) {
			content = previousIsBlock ? `\n${content}` : `${markdownBlock}${content}`;
			content = nextIsBlock ? `${content}\n` : `${content}${markdownBlock}`;

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
