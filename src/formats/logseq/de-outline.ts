// De-outline: converts Logseq's everything-is-a-bullet outline structure back
// into idiomatic flat markdown (paragraphs, headings, lists). This is the
// inverse of the "outline" function. Pure, side-effect-free.

interface OutlineNode {
	content: string;
	children: OutlineNode[];
	rawLines: string[]; // for multiline content (code blocks spanning lines)
}

/**
 * Parse indented bullet lines into a tree of OutlineNodes.
 * Handles code blocks that span multiple indented lines.
 */
function parseOutline(content: string): OutlineNode[] {
	const lines = content.split('\n');
	const root: OutlineNode[] = [];
	const stack: { indent: number, node: OutlineNode, children: OutlineNode[] }[] = [
		{ indent: -1, node: { content: '', children: root, rawLines: [] }, children: root },
	];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		// Match a bullet line: optional indent + "- " + content
		const bulletMatch = line.match(/^(\s*)- (.*)$/);

		if (!bulletMatch) {
			// Non-bullet line at top level — could be leftover content; skip it
			// (shouldn't happen in well-formed Logseq output, but be safe)
			i++;
			continue;
		}

		const indent = bulletMatch[1].length;
		const firstLineContent = bulletMatch[2];

		// Collect raw lines: the bullet line + any continuation lines
		// (indented more than the bullet, but not starting with a new bullet)
		const rawLines = [line];
		const continuationIndent = indent + 2; // content continuation is indented past "- "

		// Check if this bullet starts a code block
		let inCodeBlock = firstLineContent.match(/^```/) !== null;

		let j = i + 1;
		while (j < lines.length) {
			const nextLine = lines[j];
			const nextBulletMatch = nextLine.match(/^(\s*)- /);

			if (inCodeBlock) {
				// Inside code block: keep consuming until closing fence at same level
				rawLines.push(nextLine);
				const stripped = nextLine.replace(/^\s*/, '');
				if (stripped.match(/^```\s*$/)) {
					inCodeBlock = false;
				}
				j++;
				continue;
			}

			// If next line is a bullet at any level, stop
			if (nextBulletMatch) break;

			// If next line is a continuation (indented content under this bullet)
			// but NOT a child bullet, include as raw
			const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
			if (nextLine.trim() === '' || nextIndent >= continuationIndent) {
				rawLines.push(nextLine);
				// Check if continuation starts a code block
				if (nextLine.trim().match(/^```/)) {
					inCodeBlock = true;
				}
				j++;
			}
			else {
				break;
			}
		}

		// Build content: first line content + any continuation lines (stripped of indent)
		let fullContent = firstLineContent;
		for (let k = 1; k < rawLines.length; k++) {
			const rawLine = rawLines[k];
			// Strip the continuation indent
			const stripped = rawLine.length > continuationIndent
				? rawLine.slice(continuationIndent)
				: rawLine.trim() === '' ? '' : rawLine.replace(new RegExp(`^\\s{0,${continuationIndent}}`), '');
			fullContent += '\n' + stripped;
		}

		const node: OutlineNode = { content: fullContent, children: [], rawLines };

		// Pop stack until we find the parent (an item with smaller indent)
		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}

		// Add to parent's children
		stack[stack.length - 1].children.push(node);

		// Push this node onto the stack
		stack.push({ indent, node, children: node.children });

		i = j;
	}

	return root;
}

/** Check if content starts with a markdown heading */
function isHeading(content: string): boolean {
	return /^#{1,6}\s+\S/.test(content);
}

/** Check if a node is a task checkbox */
function isTask(content: string): boolean {
	return /^\[.\]\s/.test(content);
}

/**
 * A subtree is a "genuine list" if the parent has 2+ children that are all
 * leaf-ish items (short, no deep sub-documents). Tasks are always list items.
 */
function isGenuineList(nodes: OutlineNode[]): boolean {
	if (nodes.length < 2) return false;
	return nodes.every(node => {
		// Tasks are always list items
		if (isTask(node.content)) return true;
		// A leaf or near-leaf: has 0 or 1 children, and those children are also leaves
		if (node.children.length === 0) return true;
		// If it has children that form a genuine list, it's a list parent
		if (node.children.length >= 2 && isGenuineList(node.children)) return true;
		// Single child that is a leaf is OK (collapses)
		if (node.children.length === 1 && node.children[0].children.length === 0) return true;
		return false;
	});
}

/**
 * Check if a node represents a single-child chain that should collapse:
 * one parent with one child (not a list, not a heading, just prose).
 */
function shouldCollapseChain(node: OutlineNode): boolean {
	return (
		node.children.length === 1 &&
		!isHeading(node.children[0].content) &&
		!isTask(node.children[0].content) &&
		!isGenuineList(node.children)
	);
}

/** Serialize nodes as a markdown list with proper indentation */
function serializeList(nodes: OutlineNode[], depth: number): string[] {
	const lines: string[] = [];
	const indent = '  '.repeat(depth);

	for (const node of nodes) {
		const contentLines = node.content.split('\n');
		// First line gets the "- " prefix (or "- [ ] " for tasks)
		lines.push(`${indent}- ${contentLines[0]}`);
		// Continuation lines get indented
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

/** Serialize top-level nodes into flat markdown */
function serializeTopLevel(nodes: OutlineNode[]): string[] {
	const output: string[] = [];

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const content = node.content;

		if (isHeading(content)) {
			// Heading node: emit heading, then serialize children as body
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(content);
			if (node.children.length > 0) {
				output.push('');
				output.push(...serializeBodyUnderHeading(node.children));
			}
		}
		else if (isTask(content)) {
			// Task at top level stays as a list item
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
			// Prose parent with genuine list children: emit paragraph then list
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
			output.push('');
			output.push(...serializeList(node.children, 0));
		}
		else if (shouldCollapseChain(node)) {
			// Single-child chain: collapse
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			const collapsed = collapseChain(node);
			output.push(...collapsed.split('\n'));
		}
		else if (node.children.length > 0) {
			// Has children but not a genuine list — children are sub-documents
			// Serialize as prose paragraph then children as subsequent paragraphs
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
			output.push('');
			output.push(...serializeBodyUnderHeading(node.children));
		}
		else {
			// Plain prose: emit as paragraph
			if (output.length > 0 && output[output.length - 1] !== '') {
				output.push('');
			}
			output.push(...content.split('\n'));
		}
	}

	return output;
}

/** Collapse a single-child chain into one paragraph */
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
	// If the final node in the chain has children, append them
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

/**
 * Serialize children under a heading: they may be paragraphs, sub-headings, or lists.
 * Unlike top-level, heading children are always processed individually (not treated
 * as a "genuine list" collectively) — except when ALL are tasks.
 */
function serializeBodyUnderHeading(nodes: OutlineNode[]): string[] {
	const output: string[] = [];

	// If all children are tasks, render as a compact list
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
			output.push(content);
			if (node.children.length > 0) {
				output.push('');
				output.push(...serializeBodyUnderHeading(node.children));
			}
		}
		else if (isTask(content)) {
			// Group consecutive tasks into a compact list
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

/**
 * De-outline: converts Logseq's bullet-outline format back into idiomatic
 * flat markdown with paragraphs, headings, and properly-nested lists.
 *
 * Takes content AFTER all other conversions (tasks, properties, highlights, etc.)
 * have been applied.
 */
export function deOutline(content: string): string {
	if (!content.trim()) return content;

	// If content doesn't look like an outline (no bullet lines), return as-is
	if (!/^\s*- /m.test(content)) return content;

	const nodes = parseOutline(content);
	if (nodes.length === 0) return content;

	const lines = serializeTopLevel(nodes);

	// Clean up: remove trailing blank lines, ensure single trailing newline
	let result = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
	if (content.endsWith('\n')) result += '\n';

	return result;
}
