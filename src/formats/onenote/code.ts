export function isCodeBlock(node: Node | null): node is HTMLElement {
	if (!(node instanceof HTMLElement)) {
		return false;
	}
	const fontFamily = node.style.fontFamily;
	return fontFamily.includes('Consolas');
}

export function isBRElement(node: Node | null): node is HTMLBRElement {
	return node instanceof HTMLBRElement;
}

export function getSiblingsInSameCodeBlock(element: Element): Element[] {
	const siblingsInSameCodeBlock: Element[] = [];

	let sibling = element.nextSibling;
	while(isCodeBlock(sibling) || isBRElement(sibling)) {
		siblingsInSameCodeBlock.push(sibling);
		sibling = sibling.nextSibling;
	}

	// trim trailing BR elements. we want to end on a code block.
	const endIndex = siblingsInSameCodeBlock.findLastIndex(isCodeBlock);
	if (endIndex === -1) {
		return [];
	}
	else {
		siblingsInSameCodeBlock.length = endIndex + 1;
		return siblingsInSameCodeBlock;
	}
}
