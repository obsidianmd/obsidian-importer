/**
 * An outline, as ordinary markdown.
 *
 * In an outliner everything is a bullet, prose and headings included, so a
 * graph imported as it stands is a vault where every note is a list.
 * Flattening asks what each block was being used *as*: a paragraph, a heading
 * with something under it, or a list that is really a list.
 *
 * This works on a tree of blocks a conversion has already finished with, so
 * what is decided here is only the shape - what a block *says* was settled
 * before it arrived, and by whichever importer knows that format's markup. An
 * importer holding the source's own tree can build these nodes from it
 * directly; one whose source is markdown on disk has to parse the outline
 * first, and gets the same answers afterwards.
 */

/** A block a conversion has finished with, and the blocks under it. */
export interface OutlineNode {
	/**
	 * The converted text, several lines when the block holds a fence - or null
	 * for a block the source left empty, which writes no line of its own while
	 * what is under it stays where it was.
	 */
	text: string | null;
	/** The anchor another block reaches this one by, when one does. */
	anchor: string | null;
	/**
	 * Something that stands at the left margin as it is, in place of the block
	 * and everything under it - a pipe table, which no list item will render.
	 */
	verbatim: string | null;
	children: OutlineNode[];
}

/**
 * A block's lines, with every line after the first indented to the item's text.
 *
 * A blank line inside a fenced block is indented too. It is part of the code,
 * and left at the margin it falls out of the item that the fence around it
 * stays in. A blank line outside a fence is left bare, where spaces would only
 * be trailing whitespace on an empty line.
 *
 * The first line is returned untouched, since what goes in front of it - a
 * bullet, or nothing - is the caller's to decide.
 */
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

/**
 * A block's lines with the anchor another block reaches it by.
 *
 * The anchor goes at the end, which for a block of more than one line is a
 * line of its own: appended to a closing fence it would be read as part of the
 * code rather than as an anchor.
 */
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

/**
 * Whether these blocks are a list rather than a run of paragraphs.
 *
 * Two or more siblings that are each short enough to be an item: a leaf, a
 * task, or a parent whose own children are a list in turn. One block on its own
 * is not a list, it is a sentence that happened to be indented; a heading is
 * never an item, since it has a form of its own to become.
 */
function isList(blocks: OutlineNode[]): boolean {
	return blocks.length >= 2 && blocks.every(canBeListItem);
}

function canBeListItem(block: OutlineNode): boolean {
	if (block.verbatim !== null || block.text === null || isHeading(block)) return false;
	if (isTask(block)) return true;
	if (block.children.length === 0) return true;
	if (isList(block.children)) return true;

	// A single child carrying the same question down.
	return block.children.length === 1 && canBeListItem(block.children[0]);
}

/**
 * Whether a block and its only child are one thought split over two bullets,
 * which is what an outliner encourages and prose does not want.
 */
function isChain(block: OutlineNode): boolean {
	if (block.children.length !== 1) return false;

	const child = block.children[0];
	if (child.verbatim !== null || child.text === null || isHeading(child) || isTask(child)) return false;

	return child.children.length === 0 || isChain(child);
}

/** The text of a block, with the anchor the outline would have put on it. */
function textOf(block: OutlineNode, continuation: string = ''): string[] {
	return anchorLines(
		withContinuation((block.text ?? '').split('\n'), continuation),
		block.anchor, continuation);
}

/** A run of blocks as a markdown list, nested by depth. */
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

/** A block and its only child, and its only child, run together as prose. */
function asChain(block: OutlineNode): string[] {
	const lines = textOf(block);

	let current = block;
	while (isChain(current)) {
		current = current.children[0];
		lines.push('', ...textOf(current));
	}

	return lines;
}

/** Blocks as prose: paragraphs, headings, and the lists that are really lists. */
function asProse(blocks: OutlineNode[]): string[] {
	const lines: string[] = [];

	/** A blank line between anything and what came before it. */
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
			// Roam left the block empty, so there is nothing to say here and only
			// what was under it to carry on with.
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
				// A heading's body is read the same way any other parent's is:
				// a list where its children are a list, and prose otherwise.
				lines.push(...(isList(block.children) ? asList(block.children, 0) : asProse(block.children)));
			}
			continue;
		}

		if (isTask(block)) {
			// Tasks standing together are one list, however they were nested.
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

/**
 * A note's blocks as flat markdown.
 *
 * The top of a note is read as prose even where the same blocks one level down
 * would be a list, and that difference is the point rather than an oversight:
 * a note is a body of writing, and a run nested under something is a list of
 * things about it. Asking the list question here too turns a page whose blocks
 * are all label-like into one long bulleted list - which is the shape
 * flattening was asked to undo.
 */
export function deOutline(blocks: OutlineNode[]): string {
	return asProse(blocks).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
