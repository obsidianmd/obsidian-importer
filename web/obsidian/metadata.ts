/**
 * The metadata cache, for a host that has no index behind it.
 *
 * Obsidian answers `computeMetadataAsync` out of its own parser, and the
 * importers lean on it for the pass that turns the links a conversion emitted
 * into links the vault resolves. Without it the HTML importer waits on a
 * 'changed' event that only a real vault fires, so this reads the markdown
 * back rather than leaving the importer hanging.
 *
 * Only links and embeds, which is what that pass reads. It is deliberately not
 * a markdown parser: it skips what would make a link not a link - frontmatter,
 * fenced code, inline code - and finds the four forms Obsidian's own links
 * take. Anything subtler than that belongs to the app.
 *
 * Kept out of memoryApp, which the tests share: giving them a metadata cache
 * would turn on the link standardization their recordings were made without.
 */
import { parseFrontMatterBlock } from '../../src/util';
import { MemoryVault, memoryApp } from './vault';

interface Position {
	start: { line: number, col: number, offset: number };
	end: { line: number, col: number, offset: number };
}

interface Reference {
	link: string;
	original: string;
	displayText?: string;
	position: Position;
}

export interface Metadata {
	links: Reference[];
	embeds: Reference[];
	frontmatter?: Record<string, unknown>;
}

/** Where the content is code, or frontmatter, and so not to be read for links. */
function maskedRanges(content: string): [number, number][] {
	const ranges: [number, number][] = [];

	// Frontmatter, only when it opens the file
	if (content.startsWith('---')) {
		const end = content.indexOf('\n---', 3);
		if (end !== -1) {
			const after = content.indexOf('\n', end + 1);
			ranges.push([0, after === -1 ? content.length : after]);
		}
	}

	// Fenced code. A fence closes on its own delimiter, at least as long.
	const fence = /^(?<indent>[ \t]*)(?<delimiter>`{3,}|~{3,}).*$/gm;
	let open: { at: number, delimiter: string } | null = null;
	for (let match = fence.exec(content); match; match = fence.exec(content)) {
		const delimiter = match.groups!.delimiter;
		if (!open) {
			open = { at: match.index, delimiter: delimiter[0].repeat(delimiter.length) };
		}
		else if (delimiter[0] === open.delimiter[0] && delimiter.length >= open.delimiter.length) {
			ranges.push([open.at, match.index + match[0].length]);
			open = null;
		}
	}
	if (open) ranges.push([open.at, content.length]);

	// Inline code, which cannot span a blank line
	const code = /(`+)(?:(?!\1)[\s\S])*?\1/g;
	for (let match = code.exec(content); match; match = code.exec(content)) {
		ranges.push([match.index, match.index + match[0].length]);
	}

	return ranges;
}

function masked(ranges: [number, number][], at: number): boolean {
	return ranges.some(([from, to]) => at >= from && at < to);
}

/** Offsets are what the importers apply changes by; line and col come along. */
function positionOf(lineStarts: number[], from: number, to: number): Position {
	const place = (offset: number) => {
		let line = 0;
		while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
		return { line, col: offset - lineStarts[line], offset };
	};
	return { start: place(from), end: place(to) };
}

/**
 * A markdown link target as Obsidian records it: decoded, and unwrapped from
 * the angle brackets that let it hold a space.
 */
function targetOf(raw: string): string {
	const unwrapped = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
	try {
		return decodeURIComponent(unwrapped);
	}
	catch {
		// A stray % is not an escape, and not a reason to lose the link
		return unwrapped;
	}
}

export function parseMetadata(content: string): Metadata {
	const ranges = maskedRanges(content);
	const lineStarts = [0];
	for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) lineStarts.push(at + 1);

	const links: Reference[] = [];
	const embeds: Reference[] = [];

	// [[target|display]] and its embed, then [display](target) and its embed.
	// The markdown form takes a bracketed target so a space survives.
	const pattern = /(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]|(!?)\[([^\]]*)\]\((<[^>]*>|[^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/g;

	for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
		if (masked(ranges, match.index)) continue;

		const wiki = match[2] !== undefined;
		const bang = wiki ? match[1] : match[4];
		const link = wiki ? match[2].trim() : targetOf(match[6]);
		const displayText = wiki ? match[3] : match[5];

		if (link === '') continue;

		const reference: Reference = {
			link,
			original: match[0],
			position: positionOf(lineStarts, match.index, match.index + match[0].length),
		};
		if (displayText) reference.displayText = displayText;

		(bang === '!' ? embeds : links).push(reference);
	}

	const result: Metadata = { links, embeds };
	const frontmatter = parseFrontMatterBlock(content)?.frontMatter;
	if (frontmatter) result.frontmatter = frontmatter as Record<string, unknown>;

	return result;
}

/**
 * The app, as the website supplies it.
 *
 * memoryApp is the vault half, shared with the tests. What is added is what
 * only a host with a metadata cache can answer.
 */
export function browserApp(vault: MemoryVault) {
	const app = memoryApp(vault) as unknown as Record<string, any>;

	Object.assign(app.metadataCache, {
		// Nothing indexes here, so the cache is never dirty.
		onCleanCache: (callback: () => unknown) => { void callback(); },
		computeMetadataAsync: async (content: ArrayBuffer) => parseMetadata(new TextDecoder().decode(content)),
		fileToLinktext: (file: { basename?: string, path: string }) => file.basename ?? file.path,
		on: () => ({}),
		offref: () => {},
	});

	/**
	 * The link Obsidian would write: the shortest name that still reaches the
	 * file, which is its basename unless another note shares it.
	 */
	app.fileManager.generateMarkdownLink = (
		file: { path: string, basename?: string },
		_sourcePath: string,
		subpath?: string,
		display?: string
	) => {
		const basename = file.basename ?? file.path.slice(file.path.lastIndexOf('/') + 1).replace(/\.md$/, '');
		const sharing = vault.getMarkdownFiles()
			.filter(other => (other as { basename?: string }).basename === basename).length;
		const target = sharing > 1 ? file.path.replace(/\.md$/, '') : basename;

		return `[[${target}${subpath ?? ''}${display && display !== target ? `|${display}` : ''}]]`;
	};

	return app;
}
