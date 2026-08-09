const markdownHrefScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const unsafeMarkdownHrefScheme = /^(?:javascript|data|vbscript):/i;

export function isNormalMarkdownHref(href: string): boolean {
	if (href.startsWith('evernote://')) return false;
	if (/\s/.test(href)) return false;
	return href.startsWith('www.') || (markdownHrefScheme.test(href) && !unsafeMarkdownHrefScheme.test(href));
}
