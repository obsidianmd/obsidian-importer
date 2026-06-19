export function fixDocumentHeadingLinks(el: Element) {
	const headingTextById = new Map<string, string>();
	for (const heading of el.findAll('h1, h2, h3, h4, h5, h6')) {
		const id = heading.getAttribute('id');
		const headingText = normalizeHeadingText(heading.textContent ?? '');
		if (id && headingText && !headingTextById.has(id)) {
			headingTextById.set(id, headingText);
		}
	}
	if (headingTextById.size === 0) return;

	for (const anchor of el.findAll('a')) {
		const href = anchor.getAttribute('href');
		if (href === null) continue;

		const rewrittenHref = rewriteSameDocumentHeadingHref(href, headingTextById);
		if (rewrittenHref !== null) {
			anchor.setAttribute('href', rewrittenHref);
		}
	}
}

export function rewriteSameDocumentHeadingHref(href: string, headingTextById: ReadonlyMap<string, string>): string | null {
	if (!href.startsWith('#') || href === '#') return null;

	const fragment = href.slice(1);
	const headingText = headingTextById.get(fragment)
		?? headingTextById.get(safeDecodeURIComponent(fragment));
	if (!headingText) return null;

	const rewrittenHref = `#${headingText}`;
	return rewrittenHref === href ? null : rewrittenHref;
}

function normalizeHeadingText(text: string) {
	return text.replace(/\s+/gu, ' ').trim();
}

function safeDecodeURIComponent(value: string) {
	try {
		return decodeURIComponent(value);
	}
	catch {
		return value;
	}
}
