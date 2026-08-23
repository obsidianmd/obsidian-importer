import { markdownFenceLines, outsideMarkdownCode } from '../../markdown';

export interface DefinedId {
	uuid: string;
	shortId: string;
}

export interface BlockRefTarget {
	page: string;
	shortId: string;
}

const ID_LINE = /^(\s*)(?:- )?id:: ?([0-9a-fA-F-]{6,})\s*$/;

export function shortenId(uuid: string): string {
	const base = uuid.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
	return base.length > 0 ? base : 'ref';
}

export function attachBlockIds(content: string): { content: string, ids: DefinedId[] } {
	const lines = content.split('\n');
	const fenced = markdownFenceLines(content);
	const out: string[] = [];
	const ids: DefinedId[] = [];
	const used = new Set<string>();
	let lastContentIndex = -1;

	const makeUnique = (candidate: string): string => {
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
		let i = 1;
		while (used.has(`${candidate}-${i}`)) i++;
		const result = `${candidate}-${i}`;
		used.add(result);
		return result;
	};

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (fenced[lineIndex]) {
			if (line.trim() !== '') lastContentIndex = out.length;
			out.push(line);
			continue;
		}
		const m = line.match(ID_LINE);
		if (m && lastContentIndex >= 0) {
			const uuid = m[2];
			const indent = m[1];
			const shortId = makeUnique(shortenId(uuid));
			ids.push({ uuid, shortId });
			const target = out[lastContentIndex];
			if (!target.trimEnd().endsWith(`^${shortId}`)) {
				// A fence anchor must follow the fence, not become part of it.
				if (/^[ \t]*(?:[-*+]\s+)?[`~]{3,}[ \t]*$/.test(target)) {
					out.push(indent + `^${shortId}`);
					lastContentIndex = out.length - 1;
				}
				// Heading anchors belong on the following line.
				else if (/^#{1,6} /.test(target.trimStart().replace(/^-\s+/, ''))) {
					const isBulletHeading = /^\s*-\s+#{1,6} /.test(target);
					if (isBulletHeading) {
						out.push(indent + `^${shortId}`);
					}
					else {
						out.push(`^${shortId}`);
					}
					lastContentIndex = out.length - 1;
				}
				else {
					out[lastContentIndex] = target.replace(/\s*$/, '') + ` ^${shortId}`;
				}
			}
			continue;
		}
		// Retained property lines can own the anchor too.
		if (line.trim() !== '') {
			lastContentIndex = out.length;
		}
		out.push(line);
	}

	return { content: out.join('\n'), ids };
}

export function resolveBlockRefs(
	content: string,
	index: Map<string, BlockRefTarget>,
): string {
	return outsideMarkdownCode(content, segment => resolveSegment(segment, index));
}

function resolveSegment(text: string, index: Map<string, BlockRefTarget>): string {
	text = text.replace(/\{\{embed\s+\(\(([^()]+?)\)\)\}\}/g, (whole: string, uuid: string) => {
		const target = index.get(uuid.trim());
		return target ? `![[${target.page}#^${target.shortId}]]` : whole;
	});
	text = text.replace(/\{\{embed\s+\[\[([^\]]+?)\]\]\}\}/g, (_whole: string, page: string) => `![[${page}]]`);
	text = text.replace(/\(\(([^()]+?)\)\)/g, (whole: string, uuid: string) => {
		const target = index.get(uuid.trim());
		if (!target) return whole;
		return `[[${target.page}#^${target.shortId}]]`;
	});
	return text;
}
