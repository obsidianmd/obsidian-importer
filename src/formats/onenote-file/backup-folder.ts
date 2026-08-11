/**
 * Where OneNote for Windows keeps its own backups.
 *
 * OneNote 2016 backs every notebook up on a timer, as ordinary `.one` section
 * files under `%LOCALAPPDATA%\Microsoft\OneNote\<version>\<backup>\<notebook>`.
 * That is exactly what this importer reads, so a Windows user usually has
 * something to import without exporting anything first.
 *
 * Two things stop the path being a constant: the version folder differs by
 * release (16.0 for 2016 and Microsoft 365, 15.0 for 2013, 14.0 for 2010), and
 * the backup folder's name is translated — `Backup` in English, `Sicherung` in
 * German, `Sauvegarde` in French. So the folder is found by looking for
 * sections rather than by knowing its name, which also survives a user who
 * pointed OneNote's backup path somewhere of their own.
 *
 * Kept free of node modules so it can be driven by a test rather than a
 * Windows machine; the importer supplies the directory listing.
 */

/** Directory entries, or nothing when the directory cannot be read. */
export type ListDirectory = (directory: string) => string[] | undefined;

export interface BackupFolderProbe {
	/** `%LOCALAPPDATA%\Microsoft\OneNote`, or wherever the caller keeps it. */
	root: string;
	join: (...parts: string[]) => string;
	list: ListDirectory;
	/** How deep to look for a section before giving up. */
	maxDepth?: number;
}

const SECTION = /\.one$/i;
const VERSION = /^\d+\.\d+$/;

function holdsASection(directory: string, probe: BackupFolderProbe, depth: number): boolean {
	const entries = probe.list(directory);
	if (!entries) return false;
	if (entries.some(entry => SECTION.test(entry))) return true;
	if (depth <= 0) return false;

	return entries.some(entry => holdsASection(probe.join(directory, entry), probe, depth - 1));
}

/**
 * The folder to open a file picker at: the newest version's backup folder, or
 * the nearest thing to it that exists. Nothing when OneNote has never run here.
 */
export function findBackupFolder(probe: BackupFolderProbe): string | undefined {
	const versions = probe.list(probe.root);
	if (!versions) return undefined;

	// Newest release first: a notebook backed up by 16.0 is the likelier one.
	const ordered = versions
		.filter(entry => VERSION.test(entry))
		.sort((left, right) => parseFloat(right) - parseFloat(left));

	const maxDepth = probe.maxDepth ?? 2;

	for (const version of ordered) {
		const versionFolder = probe.join(probe.root, version);
		const candidates = probe.list(versionFolder);
		if (!candidates) continue;

		for (const candidate of candidates) {
			const folder = probe.join(versionFolder, candidate);
			if (holdsASection(folder, probe, maxDepth)) return folder;
		}
	}

	// OneNote has been here but has backed nothing up yet.
	const newest = ordered[0];
	return newest ? probe.join(probe.root, newest) : probe.root;
}
