import { TurndownNode } from './turndown-types';
import { getAttributeProxy } from './get-attribute-proxy';

const markdownBlock = '\n```\n';

const CODE_ATTRIBUTE = 'data-en-code';

const isCodeBlock = (node: TurndownNode) => {
	const nodeProxy = getAttributeProxy(node);
	const codeBlockFlag = '-en-codeblock:true';

	return nodeProxy.style && nodeProxy.style.value.indexOf(codeBlockFlag) >= 0;
};

const languageName = /^[a-z0-9+#._-]+$/;

const unhighlighted = new Set(['plaintext', 'text', 'none']);

// Evernote has used both style properties.
const languageFlags = ['-en-syntaxLanguage:', '-en-codeblockLanguage:'];

const getCodeBlockLanguage = (node: TurndownNode): string => {
	const style = getAttributeProxy(node).style?.value;
	if (!style) return '';

	for (const flag of languageFlags) {
		const at = style.indexOf(flag);
		if (at < 0) continue;

		const language = style.slice(at + flag.length).split(';')[0].trim().toLowerCase();
		if (languageName.test(language) && !unhighlighted.has(language)) return language;
	}

	return '';
};

const TEXT_NODE = 3;

// Evernote represents code lines with block elements and blank lines with <br>.
const linesAt = new Set(['DIV', 'P', 'LI', 'TR']);

const readCode = (node: Node): string => {
	let code = '';
	const breakBefore = () => {
		if (code && !code.endsWith('\n')) code += '\n';
	};

	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === TEXT_NODE) {
			code += child.nodeValue ?? '';
			continue;
		}

		const tagName = (child as Element).tagName;
		if (tagName === 'BR') {
			code += '\n';
			continue;
		}

		const ownLine = linesAt.has(tagName);
		if (ownLine) breakBefore();
		code += readCode(child);
		if (ownLine) breakBefore();
	}

	return code;
};

const getCodeText = (node: TurndownNode): string =>
	readCode(node).replace(/\u00a0/g, ' ').replace(/^\n+/, '').replace(/\n+$/, '');

// Evernote uses 40px per indent level.
const PIXELS_PER_INDENT = 40;

const getIntendNumber = (node: TurndownNode): number => {
	const nodeProxy = getAttributeProxy(node);
	const paddingAttr = 'padding-left:';
	let intendNumber = 0;
	if (nodeProxy.style && nodeProxy.style.value.indexOf(paddingAttr) >= 0) {
		const padding = Number(nodeProxy.style.value.split(paddingAttr)[1].split('px')[0]);
		intendNumber = Number.isNaN(padding) ? 0 : Math.floor(padding / PIXELS_PER_INDENT);
	}

	return intendNumber;
};

// Capture raw code before Turndown collapses whitespace across the tree.
export const captureCodeBlocks = (root: HTMLElement): HTMLElement => {
	for (const div of Array.from(root.querySelectorAll('div'))) {
		if (isCodeBlock(div)) div.setAttribute(CODE_ATTRIBUTE, getCodeText(div));
	}

	return root;
};

export const replaceCodeBlock = (content: string, node: TurndownNode): string => {
	const intend = getIntendNumber(node);
	content = `${'\t'.repeat(intend)}${content}`;

	if (isCodeBlock(node)) {
		const code = node.getAttribute(CODE_ATTRIBUTE) ?? content;

		return `\n\`\`\`${getCodeBlockLanguage(node)}\n${code}${markdownBlock}`;
	}

	return node.isBlock ? `\n${content}\n` : content;
};
