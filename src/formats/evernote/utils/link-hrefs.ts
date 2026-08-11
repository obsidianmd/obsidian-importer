const markdownHrefScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const unsafeMarkdownHrefScheme = /^(?:javascript|data|vbscript):/i;

const evernoteNoteHref = /^(?:evernote:\/\/|https?:\/\/(?:share\.evernote\.com\/note\/|(?:www\.)?evernote\.com\/shard\/))/i;

export function isEvernoteNoteHref(href: string): boolean {
	return evernoteNoteHref.test(href);
}

export function isNormalMarkdownHref(href: string): boolean {
	if (isEvernoteNoteHref(href)) return false;
	if (/\s/.test(href)) return false;
	return href.startsWith('www.') || (markdownHrefScheme.test(href) && !unsafeMarkdownHrefScheme.test(href));
}
