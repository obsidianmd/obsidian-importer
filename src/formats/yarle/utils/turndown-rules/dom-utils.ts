export const isElement = (node: Node): node is Element => {
	return node.nodeType === 1;
};
export const isImgElement = (node: Node): node is HTMLImageElement => {
	return node.nodeType === 1 && node.nodeName === 'IMG';
};
