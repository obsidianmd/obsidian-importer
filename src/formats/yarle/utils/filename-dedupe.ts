import { escapeStringRegexp } from './escape-string-regexp';

export const getFilenamePrefix = (filename: string): string => {
	return filename.split('.').slice(0, -1).join('.');
};

export const getFilenameIndexForPrefix = (filePrefix: string, fileNamePrefix: string): number | null => {
	const normalizedFilePrefix = filePrefix.toLowerCase();
	const normalizedNamePrefix = fileNamePrefix.toLowerCase();
	const indexedNameRegex = new RegExp(`^${escapeStringRegexp(normalizedNamePrefix)}\\.(\\d+)(?:$|\\s)`);

	if (normalizedFilePrefix === normalizedNamePrefix) {
		return 0;
	}

	const indexedMatch = normalizedFilePrefix.match(indexedNameRegex);
	return indexedMatch ? Number(indexedMatch[1]) : null;
};

export const getNextFilenameIndex = (files: string[], fileNamePrefix: string): number => {
	const usedIndexes = new Set<number>();
	for (const file of files) {
		const index = getFilenameIndexForPrefix(getFilenamePrefix(file), fileNamePrefix);
		if (index !== null) {
			usedIndexes.add(index);
		}
	}

	let nextIndex = 0;
	while (usedIndexes.has(nextIndex)) {
		nextIndex++;
	}
	return nextIndex;
};
