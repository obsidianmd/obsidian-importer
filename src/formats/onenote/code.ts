function isCode(node: Node|null): node is HTMLElement {
	if (!(node instanceof HTMLElement)) {
		return false;
	}
	const fontFamily = node.style.fontFamily;
	return fontFamily.includes('Consolas');
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
		&& Array.from(node.childNodes).every((c) => c.nodeType === Node.TEXT_NODE)
		// does not have any newlines
		&& !node.textContent?.trim().includes('\n')
	);
}

export function isFenceCodeBlock(node: Node): node is HTMLElement {
	return isCode(node) && !isInlineCodeSpan(node);
}

export function isBRElement(node: Node | null): node is HTMLBRElement {
	return node instanceof HTMLBRElement;
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
