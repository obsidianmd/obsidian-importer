import { outsideMarkdownFences } from './markdown';

export interface OutlineNode {
	/** Null omits the block while retaining its children. */
	text: string | null;
	anchor: string | null;
	/** Content that must remain at the left margin, such as a pipe table. */
	verbatim: string | null;
	children: OutlineNode[];
}

/** Indents continuation lines, including blank lines inside fenced code. */
export function withContinuation(lines: string[], continuation: string): string[] {
	let insideFence = false;

	return lines.map((line, index) => {
		const wasInside = insideFence;
		if (/^\s*```/.test(line)) insideFence = !insideFence;

		if (index === 0) return line;
		if (line) return continuation + line;

		return wasInside ? continuation : line;
	});
}

/** Keeps an anchor off a multiline block's closing fence. */
export function anchorLines(lines: string[], anchor: string | null, continuation: string): string[] {
	if (!anchor) return lines;

	return lines.length > 1
		? [...lines, `${continuation}^${anchor}`]
		: [`${lines[0]} ^${anchor}`];
}

const headingRe = /^#{1,6}\s+\S/;
const taskRe = /^\[.\]\s/;

function isHeading(block: OutlineNode): boolean {
	return block.verbatim === null && block.text !== null && headingRe.test(block.text);
}

function isTask(block: OutlineNode): boolean {
	return block.verbatim === null && block.text !== null && taskRe.test(block.text);
}

/** Treats two or more item-shaped siblings as a list. */
function isList(blocks: OutlineNode[]): boolean {
	return blocks.length >= 2 && blocks.every(canBeListItem);
}

function canBeListItem(block: OutlineNode): boolean {
	if (block.verbatim !== null || block.text === null || isHeading(block)) return false;
	if (isTask(block)) return true;
	if (block.children.length === 0) return true;
	if (isList(block.children)) return true;

	return block.children.length === 1 && canBeListItem(block.children[0]);
}

function isChain(block: OutlineNode): boolean {
	if (block.children.length !== 1) return false;

	const child = block.children[0];
	if (child.verbatim !== null || child.text === null || isHeading(child) || isTask(child)) return false;

	return child.children.length === 0 || isChain(child);
}

function textOf(block: OutlineNode, continuation: string = ''): string[] {
	return anchorLines(
		withContinuation((block.text ?? '').split('\n'), continuation),
		block.anchor, continuation);
}

function asList(blocks: OutlineNode[], depth: number): string[] {
	const indent = '    '.repeat(depth);
	const lines: string[] = [];

	for (const block of blocks) {
		const [first, ...rest] = textOf(block, indent + '  ');
		lines.push(`${indent}- ${first}`);
		lines.push(...rest);

		if (block.children.length > 0) lines.push(...asList(block.children, depth + 1));
	}

	return lines;
}

function asChain(block: OutlineNode): string[] {
	const lines = textOf(block);

	let current = block;
	while (isChain(current)) {
		current = current.children[0];
		lines.push('', ...textOf(current));
	}

	return lines;
}

function asProse(blocks: OutlineNode[]): string[] {
	const lines: string[] = [];

	const separate = () => {
		if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
	};

	for (let at = 0; at < blocks.length; at++) {
		const block = blocks[at];

		if (block.verbatim !== null) {
			separate();
			lines.push(...block.verbatim.split('\n').filter(line => line !== ''));
			continue;
		}

		if (block.text === null) {
			if (block.children.length > 0) {
				separate();
				lines.push(...asProse(block.children));
			}
			continue;
		}

		if (isHeading(block)) {
			separate();
			lines.push(...textOf(block));
			if (block.children.length > 0) {
				separate();
				lines.push(...(isList(block.children) ? asList(block.children, 0) : asProse(block.children)));
			}
			continue;
		}

		if (isTask(block)) {
			const run = [block];
			while (at + 1 < blocks.length && isTask(blocks[at + 1])) run.push(blocks[++at]);

			separate();
			lines.push(...asList(run, 0));
			continue;
		}

		if (isList(block.children)) {
			separate();
			lines.push(...textOf(block));
			separate();
			lines.push(...asList(block.children, 0));
			continue;
		}

		if (isChain(block)) {
			separate();
			lines.push(...asChain(block));
			continue;
		}

		separate();
		lines.push(...textOf(block));

		if (block.children.length > 0) {
			separate();
			lines.push(...asProse(block.children));
		}
	}

	return lines;
}

/** Flattens top-level blocks as prose; only nested item-shaped runs become lists. */
export function deOutline(blocks: OutlineNode[]): string {
	return outsideMarkdownFences(
		asProse(blocks).join('\n'),
		segment => segment.replace(/\n{3,}/g, '\n\n'),
	).trim();
}
