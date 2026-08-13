/** How much alt text a note is willing to carry before it reads as prose. */
const ALT_TEXT_LIMIT = 300;

/**
 * Characters that would end the label of `![...](...)`, escape past it, or open
 * something inside it. Both angle brackets go, since half a tag reads worse
 * than none of one.
 */
const UNSAFE = /[[\]\\`<>]/g;

/**
 * Trims an image's alt text down to something a markdown label can hold.
 *
 * OneNote fills this in with whatever its own OCR read off the picture, which
 * can run to paragraphs and can hold anything the image had written on it. The
 * unsafe characters are removed rather than escaped, since the OneNote API
 * importer hands the result back to `htmlToMarkdown` as an attribute and a
 * backslash of ours would be escaped a second time on the way out.
 */
export function sanitizeAltText(text: string, limit = ALT_TEXT_LIMIT): string {
	const collapsed = text.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();

	const points = [...collapsed];
	if (points.length <= limit) return collapsed;

	const cut = points.slice(0, limit).join('');
	const lastSpace = cut.lastIndexOf(' ');

	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
