export function formatRoamMarkdownLine(content: string, indent: string, isChild: boolean): string {
	if (!isChild) {
		return `${indent}${content}`;
	}

	return `${indent}* ${content}`;
}

export function getRoamChildIndent(indent: string, isChild: boolean): string {
	return isChild ? `${indent}\t` : indent;
}
