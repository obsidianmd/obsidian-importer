/**
 * Notion writes a bare URL as an anchor whose text is that same URL, which
 * htmlToMarkdown faithfully turns into `[https://example.com](https://example.com)`.
 * Obsidian renders a bare URL as a link on its own, so the pair is noise.
 *
 * Only http(s) targets are unwrapped. A schemeless one - `www.example.com` -
 * is not autolinked, so unwrapping it would turn a link into plain text.
 */

// Code is matched first so a fence or a span holding this exact syntax is
// handed back untouched rather than rewritten.
const codeOrSameTextLink = /(```[\s\S]*?```|`[^`\n]*`)|(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

// The link text arrives escaped the way Obsidian escapes markdown punctuation,
// so `a\_b` in the text has to compare equal to `a_b` in the target.
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
