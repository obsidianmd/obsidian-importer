import { markdownFenceLines, outsideMarkdownFences } from '../../markdown';

interface OutlineNode {
	content: string;
	children: OutlineNode[];
}

function parseOutline(content: string): OutlineNode[] {
	const lines = content.split('\n');
	const fenced = markdownFenceLines(content);
	const root: OutlineNode[] = [];
	const stack: { indent: number, children: OutlineNode[] }[] = [
		{ indent: -1, children: root },
	];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		const bulletMatch = line.match(/^(\s*)- (.*)$/);

		if (!bulletMatch) {
			// Preserve source content outside the outline as top-level nodes.
			const rawLines = [line];
			let j = i + 1;
			while (j < lines.length && !/^(\s*)- /.test(lines[j])) rawLines.push(lines[j++]);
			if (rawLines.some(raw => raw.trim() !== '')) {
				root.push({ content: rawLines.join('\n'), children: [] });
			}
			stack.splice(1);
			i = j;
			continue;
		}

		const indent = bulletMatch[1].length;
		const firstLineContent = bulletMatch[2];

		const rawLines = [line];
		const continuationIndent = indent + 2;

		let inCodeBlock = fenced[i];

		let j = i + 1;
		while (j < lines.length) {
			const nextLine = lines[j];
			const nextBulletMatch = nextLine.match(/^(\s*)- /);

			if (inCodeBlock) {
				rawLines.push(nextLine);
				j++;
				inCodeBlock = fenced[j] ?? false;
				continue;
			}

			if (nextBulletMatch) break;

			const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
			if (nextLine.trim() === '' || nextIndent >= continuationIndent) {
				rawLines.push(nextLine);
				j++;
				inCodeBlock = fenced[j - 1] && (fenced[j] ?? false);
			}
			else {
				break;
			}
		}

		let fullContent = firstLineContent;
		// Use the source prefix rather than counting columns so tabs survive.
		let continuationPrefix = '';
		if (rawLines.length > 1) {
			continuationPrefix = rawLines[1].match(/^(\s*)/)?.[1] ?? '';
		}
		for (let k = 1; k < rawLines.length; k++) {
			const rawLine = rawLines[k];
			let stripped: string;
			if (rawLine.trim() === '') {
				stripped = '';
			}
			else if (continuationPrefix && rawLine.startsWith(continuationPrefix)) {
				stripped = rawLine.slice(continuationPrefix.length);
			}
			else {
				const leadingWs = rawLine.match(/^(\s*)/)?.[1] ?? '';
				stripped = rawLine.slice(Math.min(leadingWs.length, continuationIndent));
			}
			fullContent += '\n' + stripped;
		}

		const node: OutlineNode = { content: fullContent, children: [] };

		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}

		stack[stack.length - 1].children.push(node);
		stack.push({ indent, children: node.children });

		i = j;
	}

	return root;
}

function isHeading(content: string): boolean {
	return /^#{1,6}\s+\S/.test(content);
}

function isTask(content: string): boolean {
	return /^\[.\]\s/.test(content);
}

function isGenuineList(nodes: OutlineNode[]): boolean {
	if (nodes.length < 2) return false;
	return nodes.every(node => isListCompatible(node));
}

function isListCompatible(node: OutlineNode): boolean {
	if (isHeading(node.content)) return false;
	if (isTask(node.content)) return true;
	if (node.children.length === 0) return true;
	if (node.children.length >= 2 && isGenuineList(node.children)) return true;
	if (node.children.length === 1 && isListCompatible(node.children[0])) return true;
	return false;
}

function shouldCollapseChain(node: OutlineNode): boolean {
	if (node.children.length !== 1) return false;
	const child = node.children[0];
	if (isHeading(child.content) || isTask(child.content)) return false;
	if (isGenuineList(node.children)) return false;
	if (child.children.length === 0) return true;
	return shouldCollapseChain(child);
}

function serializeList(nodes: OutlineNode[], depth: number): string[] {
	const lines: string[] = [];
	const indent = '  '.repeat(depth);

	for (const node of nodes) {
		const contentLines = node.content.split('\n');
		lines.push(`${indent}- ${contentLines[0]}`);
		for (let i = 1; i < contentLines.length; i++) {
			const cLine = contentLines[i];
			lines.push(cLine === '' ? '' : `${indent}  ${cLine}`);
		}

		if (node.children.length > 0) {
			lines.push(...serializeList(node.children, depth + 1));
		}
	}

	return lines;
}

function serializeTopLevel(nodes: OutlineNode[]): string[] {
	const output: string[] = [];

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const content = node.content;

		if (isHeading(content)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			// An anchor must stay adjacent to its heading.
			const headingLines = content.split('\n');
			output.push(headingLines[0]);
			if (headingLines.length > 1) {
				const nonBlankConts = headingLines.slice(1).filter(l => l.trim() !== '');
				const isJustAnchors = nonBlankConts.length > 0 &&
					nonBlankConts.every(l => /^\^[A-Za-z0-9-]+$/.test(l));
				if (!isJustAnchors) output.push('');
				output.push(...headingLines.slice(1));
			}
			if (node.children.length > 0) {
				output.push('');
				output.push(...serializeBodyUnderHeading(node.children));
			}
		}
		else if (isTask(content)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			const contentLines = content.split('\n');
			output.push(`- ${contentLines[0]}`);
			for (let k = 1; k < contentLines.length; k++) {
				const cLine = contentLines[k];
				output.push(cLine === '' ? '' : `  ${cLine}`);
			}
			if (node.children.length > 0) {
				output.push(...serializeList(node.children, 1));
			}
		}
		else if (node.children.length > 0 && isGenuineList(node.children)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
			output.push('');
			output.push(...serializeList(node.children, 0));
		}
		else if (shouldCollapseChain(node)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			const collapsed = collapseChain(node);
			output.push(...collapsed.split('\n'));
		}
		else if (node.children.length > 0) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
			output.push('');
			output.push(...serializeBodyUnderHeading(node.children));
		}
		else {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
		}
	}

	return output;
}

function collapseChain(node: OutlineNode): string {
	let result = node.content;
	let current = node;
	while (current.children.length === 1 &&
		!isHeading(current.children[0].content) &&
		!isTask(current.children[0].content)) {
		const child = current.children[0];
		result += '\n' + child.content;
		current = child;
	}
	if (current.children.length > 0) {
		if (isGenuineList(current.children)) {
			result += '\n\n' + serializeList(current.children, 0).join('\n');
		}
		else {
			result += '\n\n' + serializeBodyUnderHeading(current.children).join('\n');
		}
	}
	return result;
}

function serializeBodyUnderHeading(nodes: OutlineNode[]): string[] {
	const output: string[] = [];

	if (nodes.length >= 2 && nodes.every(n => isTask(n.content))) {
		output.push(...serializeList(nodes, 0));
		return output;
	}

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const content = node.content;

		if (isHeading(content)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			const headingLines = content.split('\n');
			output.push(headingLines[0]);
			if (headingLines.length > 1) {
				output.push('');
				output.push(...headingLines.slice(1));
			}
			if (node.children.length > 0) {
				output.push('');
				output.push(...serializeBodyUnderHeading(node.children));
			}
		}
		else if (isTask(content)) {
			const taskGroup: OutlineNode[] = [node];
			while (i + 1 < nodes.length && isTask(nodes[i + 1].content)) {
				i++;
				taskGroup.push(nodes[i]);
			}
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...serializeList(taskGroup, 0));
		}
		else if (node.children.length > 0 && isGenuineList(node.children)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
			output.push('');
			output.push(...serializeList(node.children, 0));
		}
		else if (shouldCollapseChain(node)) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...collapseChain(node).split('\n'));
		}
		else if (node.children.length > 0) {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
			output.push('');
			output.push(...serializeBodyUnderHeading(node.children));
		}
		else {
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
		}
	}

	return output;
}

export function deOutline(content: string): string {
	if (!content.trim()) return content;

	if (!/^\s*- /m.test(content)) return content;

	const nodes = parseOutline(content);
	if (nodes.length === 0) return content;

	const lines = serializeTopLevel(nodes);

	let result = outsideMarkdownFences(lines.join('\n'), segment => segment.replace(/\n{3,}/g, '\n\n')).trimEnd();
	if (content.endsWith('\n')) result += '\n';

	return result;
}
