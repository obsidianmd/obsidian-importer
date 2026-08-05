/**
 * A textbundle's note as markdown, separate from the importer that writes it.
 *
 * A textbundle is a folder: one markdown file, an info.json saying what the
 * markdown is, and an assets folder the note refers to. The conversion is the
 * asset links - where the assets themselves land is the importer's.
 */
const ASSET_LINK = /!\[\]\(assets\/([^)]*)\)/g;

const MARKDOWN_TYPE = 'net.daringfireball.markdown';

/**
 * Whether a bundle holds markdown. A bundle that does not say is taken at its
 * word: the type is optional, and the ones that omit it are markdown.
 */
export function isMarkdownBundle(infoJson: string): boolean {
	const parsed = JSON.parse(infoJson);
	return !Object.prototype.hasOwnProperty.call(parsed, 'type') || parsed.type === MARKDOWN_TYPE;
}

/** The note's name: the bundle's, without the extension. */
export function bundleNoteName(bundleName: string): string {
	return bundleName.replace(/.textbundle$/, '');
}

/** Point the note at the assets where the importer put them. */
export function convertTextbundleNote(mdContent: string, assetsFolderPath: string): string {
	if (!mdContent.match(ASSET_LINK)) {
		return mdContent;
	}

	return mdContent.replace(ASSET_LINK, `![[${assetsFolderPath}/$1]]`);
}

/**
 * The entries of one zip, split into a list per textbundle it contains.
 *
 * A zip of bundles is one export, and each bundle in it becomes a note. macOS
 * resource forks (._name) and the __MACOSX directory are not part of any
 * bundle.
 */
export function groupFilesByTextbundle<T extends { fullpath: string }>(zipName: string, entries: T[]): T[][] {
	const buckets: Record<string, T[]> = {};
	const prefix = zipName + '/';
	const dotTextbundle = '.textbundle';

	for (const entry of entries) {
		if (!entry.fullpath.startsWith(prefix)) {
			continue;
		}

		const path = entry.fullpath.slice(prefix.length);
		if (path.startsWith('._') || path.startsWith('__MACOSX')) {
			continue;
		}

		const idx = path.indexOf(dotTextbundle);
		if (idx === -1) {
			continue;
		}

		const textBundle = path.slice(0, idx) + '.textbundle';
		const rest = path.slice(idx + dotTextbundle.length + 1); // Skip the '.textbundle' and path separator

		if (rest.startsWith('._')) {
			continue;
		}

		if (textBundle in buckets) {
			buckets[textBundle].push(entry);
		}
		else {
			buckets[textBundle] = [entry];
		}
	}

	return Object.values(buckets);
}
