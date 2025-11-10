import { getAttributeProxy } from './get-attribute-proxy';

const markdownBlock = '\n```\n';

const isCodeBlock = (node: HTMLElement) => {
	const nodeProxy = getAttributeProxy(node);
	const codeBlockFlag = '-en-codeblock:true';

	const style = nodeProxy.getNamedItem('style');
	return style?.value.includes(codeBlockFlag);
};

const getIntendNumber = (node: HTMLElement): number => {
	const nodeProxy = getAttributeProxy(node);
	const paddingAttr = 'padding-left:';
	let intendNumber = 0;
	const style = nodeProxy.getNamedItem('style');
	if (style?.value.includes(paddingAttr)) {
		const px = Number.parseInt(style.value.split(paddingAttr)[1].split('px')[0], 10);
		intendNumber = Math.floor(px / 20);
	}

	return intendNumber;
};

export const unescapeMarkdown = (s: string): string => s.replace(/\\(.)/g, '$1');

export const replaceCodeBlock = (content: string, node: HTMLElement): string => {
	const intend = getIntendNumber(node);
	content = `${'\t'.repeat(intend)}${content}`;
	if (isCodeBlock(node)) {
		// turndown has already escaped markdown chars (and all '\') in content;
		// reverse that to avoid extraneous backslashes in code block.
		content = unescapeMarkdown(content);
		return `${markdownBlock}${content}${markdownBlock}`;
	}

	if (node.parentElement && isCodeBlock(node.parentElement) && node.parentElement.firstElementChild === node) {
		return `${content}`;
	}

	if (node.parentElement && isCodeBlock(node.parentElement)) {
		return `\n${content}`;
	}

	return node.isBlock ? `\n${content}\n` : content;
};
