function isCode(node: Node|null): node is HTMLElement {
	if (!(node instanceof HTMLElement)) {
		return false;
	}
	const fontFamily = node.style.fontFamily;
	return fontFamily.includes('Consolas');
}

/**
 * Return true iff node is a paragraph containing only code/line breaks
 */
export function isParagraphWrappingOnlyCode(node: Node|null): node is HTMLParagraphElement {
	return (
		node != null
		// nodeName rather than instanceOf: linkedom does not specialise <p>, so
		// the constructor check is false for every paragraph under the test
		// shim - which would leave this silently returning false there
		&& node.nodeName === 'P'
		// every() holds vacuously over no children, which made an empty
		// paragraph answer yes - and combineCodeBlocksAsNecessary then folded a
		// blank line into the code block beside it
		&& node.childNodes.length > 0
		&& Array.from(node.childNodes)
			.every(c => isCode(c) || isBRElement(c))
	);
}

export function isInlineCodeSpan(node: Node): node is HTMLElement {
	return (
		// is a code block
		isCode(node)
		// is a span element
		&& node.nodeName === 'SPAN'
		// is not part of a larger code block
		&& getSiblingsInSameCodeBlock(node).length === 0
		// only contains text nodes
		&& Array.from(node.childNodes)
			.every((c) => c.nodeType === Node.TEXT_NODE)
		// does not have any newlines
		&& !node.textContent?.trim().includes('\n')
	);
}

export function isFenceCodeBlock(node: Node): node is HTMLElement {
	return isCode(node) && !isInlineCodeSpan(node);
}

export function isBRElement(node: Node | null): node is HTMLBRElement {
	// nodeName rather than instanceof: linkedom has no HTMLBRElement at all, so
	// the constructor check throws a ReferenceError under the test shim
	return node != null && node.nodeName === 'BR';
}

export function getSiblingsInSameCodeBlock(element: Element): Element[] {
	const siblingsInSameCodeBlock: Element[] = [];

	let sibling = element.nextSibling;
	while(isCode(sibling) || isBRElement(sibling)) {
		siblingsInSameCodeBlock.push(sibling);
		sibling = sibling.nextSibling;
	}

	// trim trailing BR elements. we want to end on a code block.
	const endIndex = siblingsInSameCodeBlock.findLastIndex(isCode);
	if (endIndex === -1) {
		return [];
	}
	else {
		siblingsInSameCodeBlock.length = endIndex + 1;
		return siblingsInSameCodeBlock;
	}
}
