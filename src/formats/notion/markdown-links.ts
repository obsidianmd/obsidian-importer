const sameTextUrlLink = /(^|[^!])\[([^\]\n]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)/g;
const escapedMarkdownPunctuation = /\\([\\`*_[\]{}()#+.!-])/g;

function normalizeUrlText(value: string) {
	return value.trim().replace(escapedMarkdownPunctuation, '$1');
}

export function preserveBareUrlLinks(markdownBody: string) {
	return markdownBody.replace(sameTextUrlLink, (match, prefix: string, text: string, url: string) => {
		if (normalizeUrlText(text) !== normalizeUrlText(url)) {
			return match;
		}

		return `${prefix}${url}`;
	});
}
