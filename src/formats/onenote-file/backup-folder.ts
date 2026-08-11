export type ListDirectory = (directory: string) => string[] | undefined;

export interface BackupFolderProbe {
	root: string;
	join: (...parts: string[]) => string;
	list: ListDirectory;
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

export function findBackupFolder(probe: BackupFolderProbe): string | undefined {
	const versions = probe.list(probe.root);
	if (!versions) return undefined;

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

	const newest = ordered[0];
	return newest ? probe.join(probe.root, newest) : probe.root;
}
