const tagEdgeChar = String.raw`\p{L}\p{M}\p{N}_`;
const tagBodyChar = String.raw`${tagEdgeChar}/\-`;
const simpleTagRegex = new RegExp(
	String.raw`(?<!\S)#([${tagEdgeChar}][${tagBodyChar}]*[${tagEdgeChar}]|[${tagEdgeChar}]+)(?![#${tagEdgeChar}/])`,
	'gu'
);
const invalidSimpleTagCharRegex = new RegExp(String.raw`[^${tagBodyChar}]`, 'gu');

export function normalizeBearTagsInMarkdown(mdContent: string): string {
	// Replace spaces in enclosed tags with underscores and make them classic tags.
	mdContent = mdContent.replace(/#([^\n#]+?[^\s])#/g, (_match, tag) => { // require non-space before closing to avoid using next tag's opening #
		return '#' + tag.replace(/\s+/g, '_');
	});

	// Remove special characters in simple tags while preserving Unicode letters.
	mdContent = mdContent.replace(/#([^0-9\s#]+)/gu, (_match, tag) => {
		let cleanTag = tag.replace(invalidSimpleTagCharRegex, '_');
		cleanTag = cleanTag.replace(/_+/g, '_'); // collapse multiple underscores
		return '#' + cleanTag;
	});

	return mdContent;
}

export function extractBearTagsFromContent(content: string, flattenTags = false): string[] {
	const tags = new Set<string>();
	let matchSimple;
	while ((matchSimple = simpleTagRegex.exec(content)) !== null) {
		const rawSimpleTag = matchSimple[1].trim();
		if (rawSimpleTag !== '') {
			if (flattenTags && rawSimpleTag.includes('/')) {
				const parts = rawSimpleTag.split('/');
				for (const part of parts) {
					tags.add(part);
				}
			}
			else {
				tags.add(rawSimpleTag);
			}
		}
	}

	return Array.from(tags);
}
