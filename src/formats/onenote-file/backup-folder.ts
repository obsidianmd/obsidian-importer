export interface BackupFolderEntry {
	name: string;
	isDirectory: boolean;
}

export type ListDirectory = (directory: string) => Promise<BackupFolderEntry[] | undefined>;

export interface BackupFolderProbe {
	root: string;
	join: (...parts: string[]) => string;
	list: ListDirectory;
	maxDepth?: number;
}

const SECTION = /\.one$/i;
const VERSION = /^\d+\.\d+$/;

async function holdsASection(directory: string, probe: BackupFolderProbe, depth: number): Promise<boolean> {
	const entries = await probe.list(directory);
	if (!entries) return false;
	if (entries.some(entry => !entry.isDirectory && SECTION.test(entry.name))) return true;
	if (depth <= 0) return false;

	for (const entry of entries) {
		if (!entry.isDirectory) continue;
		if (await holdsASection(probe.join(directory, entry.name), probe, depth - 1)) return true;
	}

	return false;
}

export async function findBackupFolder(probe: BackupFolderProbe): Promise<string | undefined> {
	const versions = await probe.list(probe.root);
	if (!versions) return undefined;

	const ordered = versions
		.filter(entry => entry.isDirectory && VERSION.test(entry.name))
		.map(entry => entry.name)
		.sort((left, right) => parseFloat(right) - parseFloat(left));

	const maxDepth = probe.maxDepth ?? 2;

	for (const version of ordered) {
		const versionFolder = probe.join(probe.root, version);
		const candidates = await probe.list(versionFolder);
		if (!candidates) continue;

		for (const candidate of candidates) {
			if (!candidate.isDirectory) continue;
			const folder = probe.join(versionFolder, candidate.name);
			if (await holdsASection(folder, probe, maxDepth)) return folder;
		}
	}

	const newest = ordered[0];
	return newest ? probe.join(probe.root, newest) : probe.root;
}
