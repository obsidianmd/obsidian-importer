import { TurndownNode } from './turndown-types';
import { getAttributeProxy } from './get-attribute-proxy';

const markdownBlock = '\n```\n';

/** Where the code waits between being read and being fenced. */
const CODE_ATTRIBUTE = 'data-en-code';

const isCodeBlock = (node: TurndownNode) => {
	const nodeProxy = getAttributeProxy(node);
	const codeBlockFlag = '-en-codeblock:true';

	return nodeProxy.style && nodeProxy.style.value.indexOf(codeBlockFlag) >= 0;
};

const languageName = /^[a-z0-9+#._-]+$/;

const unhighlighted = new Set(['plaintext', 'text', 'none']);

/** Evernote has written the language under both names. */
const languageFlags = ['-en-syntaxLanguage:', '-en-codeblockLanguage:'];

/** Evernote names a language the way Prism does, which is what Obsidian highlights with. */
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

/** Evernote writes each line of a block as a div, and a blank one as a br. */
const linesAt = new Set(['DIV', 'P', 'LI', 'TR']);

/**
 * The code as it was written.
 *
 * Turndown collapses runs of whitespace, which is every indent a code block
 * has, and escapes what it reads as Markdown. Reading the nodes instead keeps
 * the text intact — including the non-breaking spaces Evernote indents with,
 * which are turned back into the spaces they stand for so the code still runs
 * when it is copied out.
 */
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

const getIntendNumber = (node: TurndownNode): number => {
	const nodeProxy = getAttributeProxy(node);
	const paddingAttr = 'padding-left:';
	let intendNumber = 0;
	if (nodeProxy.style && nodeProxy.style.value.indexOf(paddingAttr) >= 0) {
		const padding = Number(nodeProxy.style.value.split(paddingAttr)[1].split('px')[0]);
		intendNumber = Number.isNaN(padding) ? 0 : Math.floor(padding / 20);
	}

	return intendNumber;
};

/**
 * Take down the text of every code block, before turndown runs.
 *
 * Turndown collapses runs of whitespace, which is every indent a code block
 * has, and it does so across the whole tree before a single rule is asked
 * anything. Reading the code here is what keeps it as it was written.
 */
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
