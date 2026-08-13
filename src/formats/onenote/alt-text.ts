const ALT_TEXT_LIMIT = 300;
const MARKDOWN_SYNTAX = /[[\]\\`<>]/g;

export function sanitizeAltText(text: string, limit = ALT_TEXT_LIMIT): string {
	// Escaping here would be escaped again when the API importer converts HTML.
	const collapsed = text.replace(MARKDOWN_SYNTAX, '').replace(/\s+/g, ' ').trim();

	const points = [...collapsed];
	if (points.length <= limit) return collapsed;

	const cut = points.slice(0, limit).join('');
	const lastSpace = cut.lastIndexOf(' ');

	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
