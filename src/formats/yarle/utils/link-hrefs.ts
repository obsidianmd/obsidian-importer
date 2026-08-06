const markdownHrefScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const unsafeMarkdownHrefScheme = /^(?:javascript|data|vbscript):/i;

export function isNormalMarkdownHref(href: string): boolean {
	// Evernote note links are resolved after import so they need the internal-link path.
	if (href.startsWith('evernote://')) return false;
	return href.startsWith('www.') || (markdownHrefScheme.test(href) && !unsafeMarkdownHrefScheme.test(href));
}
