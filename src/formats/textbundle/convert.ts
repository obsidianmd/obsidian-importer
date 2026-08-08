const ASSET_LINK = /!\[\]\(assets\/([^)]*)\)/g;

const MARKDOWN_TYPE = 'net.daringfireball.markdown';

export function isMarkdownBundle(infoJson: string): boolean {
	const parsed = JSON.parse(infoJson);
	return !Object.prototype.hasOwnProperty.call(parsed, 'type') || parsed.type === MARKDOWN_TYPE;
}

export function bundleNoteName(bundleName: string): string {
	return bundleName.replace(/.textbundle$/, '');
}

export function convertTextbundleNote(mdContent: string, assetsFolderPath: string): string {
	if (!mdContent.match(ASSET_LINK)) {
		return mdContent;
	}

	return mdContent.replace(ASSET_LINK, `![[${assetsFolderPath}/$1]]`);
}

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
		const rest = path.slice(idx + dotTextbundle.length + 1);

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
