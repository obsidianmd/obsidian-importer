export interface ImporterFileTypes {
	id: string;
	extensions: readonly string[];
}

export function readableFiles<T extends { extension: string }>(importers: ImporterFileTypes[], files: T[]): T[] {
	return files.filter(file => importers.some(({ extensions }) => extensions.includes(file.extension)));
}

export function importersForFiles(importers: ImporterFileTypes[], extensions: string[]): string[] {
	const ranked = importers
		.map(({ id, extensions: accepted }) => ({
			id,
			taken: extensions.filter(extension => accepted.includes(extension)).length,
			claims: accepted.length,
		}))
		.filter(candidate => candidate.taken > 0);

	ranked.sort((a, b) => b.taken - a.taken || a.claims - b.claims);

	return ranked.map(candidate => candidate.id);
}
