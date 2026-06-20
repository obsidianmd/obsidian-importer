export function extractZohoNotecardName(dataNotecard: string | null | undefined): string | null {
	if (!dataNotecard) {
		return null;
	}

	let metadata: unknown;
	try {
		metadata = JSON.parse(dataNotecard);
	}
	catch {
		return null;
	}

	if (!metadata || typeof metadata !== 'object') {
		return null;
	}

	const name = (metadata as { name?: unknown }).name;
	if (typeof name !== 'string') {
		return null;
	}

	return name.trim() || null;
}

export function extractHtmlImportTitle(dom: HTMLElement, fallbackTitle: string): string {
	const body = dom.querySelector('body');
	return extractZohoNotecardName(body?.getAttribute('data-notecard')) ?? fallbackTitle;
}
