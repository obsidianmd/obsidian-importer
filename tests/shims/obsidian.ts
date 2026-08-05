/**
 * The parts of the `obsidian` module the conversion code reaches.
 *
 * node_modules/obsidian ships type declarations only - there is no runtime
 * module - so anything importing it fails outside the app. This stands in for
 * the pieces used on the conversion path.
 *
 * It is deliberately small. If a test needs more of the API than this, that is
 * a signal the code under test is reaching into the app rather than converting
 * data, and belongs behind the sink interface instead of here.
 */
import moment from 'moment';
import * as yaml from 'yaml';

export { moment };

/**
 * Frontmatter, in the dialect Obsidian writes.
 *
 * Checked against the app rather than assumed: a note written through
 * processFrontMatter comes back with two-space list indentation, plain scalars
 * wherever YAML allows them - a date, a time, "yes" - double quotes on anything
 * that does need quoting, and a null property written as the key alone.
 *
 * All of that is what this library does by default, bar the null, hence
 * nullStr. lineWidth is off so a long value is never wrapped, since a wrapped
 * line would change a recorded note without changing what it holds.
 */
export function stringifyYaml(value: unknown): string {
	return yaml.stringify(value, { nullStr: '', lineWidth: 0 });
}

/** Everything Obsidian's htmlToMarkdown accepts, as markup turndown can read. */
function markupOf(html: string | Document | HTMLElement | DocumentFragment): string {
	if (typeof html === 'string') return html;
	if ('outerHTML' in html) return html.outerHTML;
	if ('documentElement' in html) return html.documentElement.outerHTML;

	// A fragment has no markup of its own, only its children's
	return Array.from(html.childNodes)
		.map(node => (node as Element).outerHTML ?? node.textContent ?? '')
		.join('');
}

/**
 * The shim's signatures, held against the real ones.
 *
 * Nothing typechecks this file with `obsidian` mapped to it - the plugin uses
 * far more of the API than a conversion does, so substituting the shim for the
 * whole of src would fail for good reasons. Anchoring each export to the type
 * it stands in for catches the drift that matters: the app changing what it
 * takes or returns.
 */
type RealApi = typeof import('obsidian');
const _stringifyYaml: RealApi['stringifyYaml'] = stringifyYaml;
const _parseYaml: RealApi['parseYaml'] = parseYaml;
const _normalizePath: RealApi['normalizePath'] = normalizePath;
const _htmlToMarkdown: RealApi['htmlToMarkdown'] = htmlToMarkdown;

export function parseYaml(text: string): unknown {
	return yaml.parse(text);
}

/**
 * HTML to markdown.
 *
 * Obsidian's own is turndown underneath, which is why the app exposes
 * TurndownService at all, so this is turndown with the settings that match
 * what the app produces on the fixtures here: ATX headings, fenced code, and
 * asterisks for emphasis and bullets.
 *
 * The rules below were each added to close a difference from the app, checked
 * against it on the fixtures here: as of the HTML and Notion fixtures the
 * output is byte for byte the same. Obsidian's build still has rules of its
 * own, so a recording made through this is best read as a regression check on
 * the transformations that run before it - which is where this importer's own
 * behaviour lives - rather than as proof of the exact markdown a user sees.
 */
export function htmlToMarkdown(html: string | Document | HTMLElement | DocumentFragment): string {
	const source = markupOf(html);

	// Required lazily: turndown wants a DOM, which the dom shim installs.
	const TurndownService = require('turndown');
	const service = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		emDelimiter: '_',
		bulletListMarker: '-',
		hr: '---',
	});

	// Obsidian does not escape markdown punctuation coming out of HTML, so a
	// callout's [!important] stays as written rather than becoming \[!important\].
	service.escape = (text: string) => text;

	// Obsidian drops these rather than letting their text through, which
	// matters when a whole document is converted and its head comes along.
	service.remove(['head', 'title', 'style', 'script', 'iframe'] as never);

	// Obsidian percent-encodes a space in a link target; turndown wraps the
	// whole target in angle brackets instead.
	const escapeUri = (uri: string) => uri.replace(/ /g, '%20').replace(/([()])/g, '\\$1');

	service.addRule('inlineLink', {
		filter: (node: any) => node.nodeName === 'A' && node.getAttribute('href'),
		replacement: (content: string, node: any) => {
			const title = node.getAttribute('title');
			return `[${content}](${escapeUri(node.getAttribute('href'))}${title ? ` "${title}"` : ''})`;
		},
	});

	service.addRule('image', {
		filter: 'img',
		replacement: (_content: string, node: any) => {
			const src = node.getAttribute('src');
			if (!src) return '';
			const title = node.getAttribute('title');
			return `![${node.getAttribute('alt') || ''}](${escapeUri(src)}${title ? ` "${title}"` : ''})`;
		},
	});

	// <mark> is a highlight in Obsidian's flavour.
	service.addRule('highlight', {
		filter: ['mark' as never],
		replacement: (content: string) => `==${content}==`,
	});

	// turndown leaves del/s alone without its GFM plugin; Obsidian strikes them.
	service.addRule('strikethrough', {
		filter: ['del', 's', 'strike' as never],
		replacement: (content: string) => `~~${content}~~`,
	});

	// turndown pads a list marker to four columns; Obsidian writes one space,
	// and indents what follows within the item by four. Checked against the app.
	service.addRule('listItem', {
		filter: 'li',
		replacement: (content: string, node: any) => {
			const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
			let prefix = '- ';

			const parent = node.parentNode;
			if (parent && parent.nodeName === 'OL') {
				// A start nobody can read is no start at all
				const start = Number(parent.getAttribute('start'));
				const index = Array.prototype.indexOf.call(parent.children, node);
				prefix = `${Number.isFinite(start) && parent.getAttribute('start') ? start + index : index + 1}. `;
			}

			return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
		},
	});

	return service.turndown(source);
}

/**
 * Desktop, and not Obsidian.
 *
 * isDesktopApp is false so filesystem.ts does not try Electron's require at
 * import time; the test supplies node's real modules through
 * provideNodeModules instead.
 */
export const Platform = {
	isDesktopApp: false,
	isDesktop: true,
	isMobile: false,
	isMacOS: process.platform === 'darwin',
	isWin: process.platform === 'win32',
	isLinux: process.platform === 'linux',
};

/** Matches Obsidian's own: forward slashes, no duplicate or trailing ones. */
export function normalizePath(path: string): string {
	const normalized = path
		.replace(/([\\/])+/g, '/')
		.replace(/(^\/+|\/+$)/g, '');
	return normalized === '' ? '/' : normalized;
}
