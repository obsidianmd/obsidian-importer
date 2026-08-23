import { outsideMarkdownCode } from '../../markdown';

export interface AssetRef {
	sourcePath: string;
	filename: string;
}

export interface ConvertAssetOptions {
	/** Return null to preserve the source link. */
	target?: (asset: AssetRef) => string | null;
}

// Accepts balanced parentheses in paths and one nested bracket pair in labels.
const assetLinkRegex = /(!?)\[([^[\]]*(?:\[[^\]]*\][^[\]]*)*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)(\{:[^}]*\})?/g;
function isUrl(path: string): boolean {
	return /^(https?:|data:)/i.test(path.trim());
}

function basename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1];
}

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
	options: ConvertAssetOptions = {},
): { content: string, assets: AssetRef[] } {
	const assets: AssetRef[] = [];
	const seen = new Set<string>();

	function rewriteAssets(text: string): string {
		assetLinkRegex.lastIndex = 0;
		return text.replace(assetLinkRegex, (match, bang: string, _alt: string, path: string, dimSuffix?: string) => {
			if (isUrl(path) || !path.includes('assets/')) return match;

			const asset = { sourcePath: path, filename: basename(path) };
			if (!seen.has(path)) {
				seen.add(path);
				assets.push(asset);
			}
			const target = options.target ? options.target(asset) : asset.filename;
			if (target === null) return match;

			const dims = dimensionDisplay(dimSuffix);
			const embed = bang === '!' ? '!' : '';
			return dims !== null ? `${embed}[[${target}|${dims}]]` : `${embed}[[${target}]]`;
		});
	}

	return { content: outsideMarkdownCode(content, rewriteAssets), assets };
}
