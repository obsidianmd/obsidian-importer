/**
 * A Roam outline, as ordinary markdown.
 *
 * Everything in Roam is a bullet, including prose and headings, so a graph
 * imported as it stands is a vault where every note is a list. Flattening asks
 * what each block was being used *as*: a paragraph, a heading with something
 * under it, or a list that is really a list.
 *
 * It works on the blocks the converter has already rendered, so what is decided
 * here is only the shape - the text inside a block was settled before it
 * arrived. Roam hands us the tree, so unlike the same conversion for a
 * file-based outliner there is nothing to parse back out of the markdown.
 */

/** A block the converter has finished with, and the blocks under it. */
export interface RenderedBlock {
	/**
	 * The converted text, several lines when the block holds a fence - or null
	 * for a block Roam left empty, which writes no line of its own while what
	 * is under it stays where it was.
	 */
	text: string | null;
	/** The anchor another block reaches this one by, when one does. */
	anchor: string | null;
	/** A table stands in place of the block and everything under it. */
	table: string | null;
	children: RenderedBlock[];
}

const headingRe = /^#{1,6}\s+\S/;
const taskRe = /^\[.\]\s/;

function isHeading(block: RenderedBlock): boolean {
	return block.table === null && block.text !== null && headingRe.test(block.text);
}

function isTask(block: RenderedBlock): boolean {
	return block.table === null && block.text !== null && taskRe.test(block.text);
}

/**
 * Whether these blocks are a list rather than a run of paragraphs.
 *
 * Two or more siblings that are each short enough to be an item: a leaf, a
 * task, or a parent whose own children are a list in turn. One block on its own
 * is not a list, it is a sentence that happened to be indented; a heading is
 * never an item, since it has a form of its own to become.
 */
function isList(blocks: RenderedBlock[]): boolean {
	return blocks.length >= 2 && blocks.every(canBeListItem);
}

function canBeListItem(block: RenderedBlock): boolean {
	if (block.table !== null || block.text === null || isHeading(block)) return false;
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
function isChain(block: RenderedBlock): boolean {
	if (block.children.length !== 1) return false;

	const child = block.children[0];
	if (child.table !== null || child.text === null || isHeading(child) || isTask(child)) return false;

	return child.children.length === 0 || isChain(child);
}

/** The text of a block, with the anchor the outline would have put on it. */
function textOf(block: RenderedBlock, continuation: string = ''): string[] {
	const lines = (block.text ?? '').split('\n');
	const written = [lines[0], ...lines.slice(1).map(line => line ? continuation + line : line)];

	if (block.anchor) {
		// As in the outline, an anchor cannot follow a closing fence on its own
		// line without being read as part of the code.
		if (written.length > 1) written.push(continuation + `^${block.anchor}`);
		else written[0] += ` ^${block.anchor}`;
	}

	return written;
}

/** A run of blocks as a markdown list, nested by depth. */
function asList(blocks: RenderedBlock[], depth: number): string[] {
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
function asChain(block: RenderedBlock): string[] {
	const lines = textOf(block);

	let current = block;
	while (isChain(current)) {
		current = current.children[0];
		lines.push('', ...textOf(current));
	}

	return lines;
}

/** Blocks as prose: paragraphs, headings, and the lists that are really lists. */
function asProse(blocks: RenderedBlock[]): string[] {
	const lines: string[] = [];

	/** A blank line between anything and what came before it. */
	const separate = () => {
		if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
	};

	for (let at = 0; at < blocks.length; at++) {
		const block = blocks[at];

		if (block.table !== null) {
			separate();
			lines.push(...block.table.split('\n').filter(line => line !== ''));
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
				lines.push(...asProse(block.children));
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
 * A page's blocks as flat markdown.
 *
 * The top level is prose rather than a list even when it looks like one: a page
 * whose blocks are all short is a page of short paragraphs, and turning the
 * whole note into one bulleted list is what flattening was asked to undo.
 */
export function deOutline(blocks: RenderedBlock[]): string {
	return asProse(blocks).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
