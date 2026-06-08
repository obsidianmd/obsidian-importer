// Converts Logseq's relative markdown asset links (`![alt](../assets/x.png)`)
// into Obsidian wiki-embeds (`![[x.png]]`). Pure functions only — no filesystem
// access, no 'obsidian' import — so it can be unit-tested in isolation.

export interface AssetRef {
	/** The path exactly as written in the original link, e.g. `../assets/image.png`. */
	sourcePath: string;
	/** The basename of the asset, e.g. `image.png`. */
	filename: string;
}

// `[alt](path)` or `![alt](path)` optionally followed by `{: ... }`.
// H1: path allows balanced parens (e.g. filename with `(...)`).
// H2: leading `!` is optional so plain links are also converted.
// H2b: label allows one level of nested brackets (e.g. `[Fw_ [Nested] _ desc]`).
const assetLinkRegex = /(!?)\[([^\[\]]*(?:\[[^\]]*\][^\[\]]*)*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)(\{:[^}]*\})?/g;
// Triple-backtick fenced code blocks, which must be left untouched.
const fencedCodeRegex = /```[\s\S]*?```/g;
// Inline-code spans that must not be rewritten (M1).
const inlineCodeRe = /`[^`]*`/g;

function isUrl(path: string): boolean {
	return /^(https?:|data:)/i.test(path.trim());
}

function basename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1];
}

/** Builds the Obsidian `|size` display from a Logseq `{:height H, :width W}` suffix. */
function dimensionDisplay(suffix: string | undefined): string | null {
	if (!suffix) return null;
	const width = suffix.match(/:width\s+(\d+)/)?.[1];
	const height = suffix.match(/:height\s+(\d+)/)?.[1];
	if (width && height) return `${width}x${height}`;
	if (width) return width;
	if (height) return height;
	return null;
}

export function convertAssetLinks(
	content: string,
	options: { keepAltText: boolean }
): { content: string, assets: AssetRef[] } {
	const assets: AssetRef[] = [];
	const seen = new Set<string>();

	function transformSegment(segment: string): string {
		// M1: protect inline-code spans — only rewrite content outside them.
		let result = '';
		let last = 0;
		let icm: RegExpExecArray | null;
		inlineCodeRe.lastIndex = 0;
		while ((icm = inlineCodeRe.exec(segment)) !== null) {
			result += rewriteAssets(segment.slice(last, icm.index));
			result += icm[0];
			last = icm.index + icm[0].length;
		}
		result += rewriteAssets(segment.slice(last));
		return result;
	}

	function rewriteAssets(text: string): string {
		assetLinkRegex.lastIndex = 0;
		return text.replace(assetLinkRegex, (match, bang: string, alt: string, path: string, dimSuffix?: string) => {
			if (isUrl(path) || !path.includes('assets/')) return match;

			const filename = basename(path);
			if (!seen.has(path)) {
				seen.add(path);
				assets.push({ sourcePath: path, filename });
			}

			const dims = dimensionDisplay(dimSuffix);
			let display: string | null = dims;
			if (display === null && options.keepAltText && alt.trim().length > 0) {
				display = alt;
			}

			const embed = bang === '!' ? '!' : '';
			return display !== null ? `${embed}[[${filename}|${display}]]` : `${embed}[[${filename}]]`;
		});
	}

	let result = '';
	let lastIndex = 0;
	let fence: RegExpExecArray | null;
	fencedCodeRegex.lastIndex = 0;
	while ((fence = fencedCodeRegex.exec(content)) !== null) {
		result += transformSegment(content.slice(lastIndex, fence.index));
		result += fence[0];
		lastIndex = fence.index + fence[0].length;
	}
	result += transformSegment(content.slice(lastIndex));

	return { content: result, assets };
}
