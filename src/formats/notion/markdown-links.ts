
const codeOrSameTextLink = /(```[\s\S]*?```|`[^`\n]*`)|(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

const escapedPunctuation = /\\([\\`*_[\]{}()#+.!-])/g;

function unescapeMarkdown(value: string) {
	return value.trim().replace(escapedPunctuation, '$1');
}

export function preserveBareUrlLinks(markdownBody: string) {
	return markdownBody.replace(
		codeOrSameTextLink,
		(match, code: string | undefined, text: string, url: string) => {
			if (code !== undefined) return code;
			return unescapeMarkdown(text) === unescapeMarkdown(url) ? url : match;
		}
	);
}
