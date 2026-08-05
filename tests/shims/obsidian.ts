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
import * as yaml from 'js-yaml';

export { moment };

/**
 * Frontmatter, in the dialect Obsidian writes.
 *
 * Checked against the app rather than assumed: a note written through
 * processFrontMatter comes back with two-space list indentation and plain
 * scalars wherever YAML allows them, which is what js-yaml produces here.
 * lineWidth is off so a long value is never wrapped, since a wrapped line
 * would change a recorded note without changing its meaning.
 */
export function stringifyYaml(value: unknown): string {
	return yaml.dump(value, { lineWidth: -1 });
}

export function parseYaml(text: string): unknown {
	return yaml.load(text);
}

/**
 * HTML to markdown.
 *
 * Obsidian's own is turndown underneath, which is why the app exposes
 * TurndownService at all, so this is turndown with the settings that match
 * what the app produces on the fixtures here: ATX headings, fenced code, and
 * asterisks for emphasis and bullets.
 *
 * This is the least certain part of the shim. Obsidian's build has rules of
 * its own, so treat a recording made through this as a regression check on the
 * transformations that run before it - which is where this importer's own
 * behaviour lives - rather than as proof of the exact markdown a user sees.
 */
export function htmlToMarkdown(html: string | { innerHTML?: string, outerHTML?: string }): string {
	const source = typeof html === 'string' ? html : html.outerHTML ?? html.innerHTML ?? '';

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

	// turndown pads a list marker to four columns; Obsidian writes one space.
	// and indents nested content by two. Checked against the app.
	service.addRule('listItem', {
		filter: 'li',
		replacement: (content: string, node: any) => {
			const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
			let prefix = '- ';

			const parent = node.parentNode;
			if (parent && parent.nodeName === 'OL') {
				const start = parent.getAttribute('start');
				const index = Array.prototype.indexOf.call(parent.children, node);
				prefix = `${start ? Number(start) + index : index + 1}. `;
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
