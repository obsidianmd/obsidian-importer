const markdownHrefScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const unsafeMarkdownHrefScheme = /^(?:javascript|data|vbscript):/i;

export function isNormalMarkdownHref(href: string): boolean {
	// Evernote note links are resolved after import so they need the internal-link path.
	if (href.startsWith('evernote://')) return false;
	// A scheme is a bare word and a colon, which is also what a note title
	// looks like when it starts "Re:" or "TODO:". A URI cannot hold a raw
	// space and those titles routinely do, so it tells the two apart.
	if (/\s/.test(href)) return false;
	return href.startsWith('www.') || (markdownHrefScheme.test(href) && !unsafeMarkdownHrefScheme.test(href));
}
