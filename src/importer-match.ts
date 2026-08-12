/**
 * Which importer a file belongs to, going by its extension alone.
 *
 * What a drop on the window has to answer before anything can be imported. An
 * extension rarely names one importer - three of them read a `.zip` - so this
 * ranks the candidates rather than picking one, and the caller asks when more
 * than one is left.
 */
export interface ImporterFileTypes {
	id: string;
	extensions: readonly string[];
}

/**
 * The importers that could read these files, likeliest first: the one that
 * takes most of what was dropped, and among equals the one that claims fewer
 * file types, since a narrow claim is the more particular one.
 */
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
