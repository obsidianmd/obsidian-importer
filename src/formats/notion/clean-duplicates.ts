import { normalizePath, TAbstractFile, Vault } from 'obsidian';
import { availableFileName } from '../../util';
import { NotionResolverInfo } from './notion-types';

/**
 * The paths an import has spoken for.
 *
 * Notion settles every file name before it converts a single page: a link to
 * another page is written as [[title]], so the title has to be the one that
 * note is really saved under. The vault cannot be asked - none of those files
 * exist yet - so what is taken is tracked here, seeded with what the vault
 * already holds, and what a taken name becomes is left to availableFileName,
 * which is the rule createFile follows when the write finally happens.
 *
 * Compared without regard to case, because the filesystem is: on macOS and
 * Windows "MYITEM.md" and "Myitem.md" are one file, and an exact comparison
 * hands the second one back as free, which is a note the import then loses to
 * "File already exists" (#223).
 */
class ReservedPaths {
	private taken = new Set<string>();

	constructor(existing: TAbstractFile[]) {
		for (const file of existing) this.add(file.path);
	}

	private add(path: string): void {
		this.taken.add(normalizePath(path).toLowerCase());
	}

	private has(path: string): boolean {
		return this.taken.has(normalizePath(path).toLowerCase());
	}

	/**
	 * Reserve a free name in a folder, and say which name that was.
	 *
	 * @param parentPath - Folder to reserve in, ending in "/" as this importer writes them
	 * @param fileName - Name with extension, e.g. "Note.md"
	 */
	take(parentPath: string, fileName: string): string {
		const name = availableFileName(fileName, candidate => this.has(`${parentPath}${candidate}`));

		this.add(`${parentPath}${name}`);
		return name;
	}
}

export function cleanDuplicates({
	info,
	vault,
	targetFolderPath,
	parentsInSubfolders,
}: {
	info: NotionResolverInfo;
	vault: Vault;
	targetFolderPath: string;
	parentsInSubfolders: boolean;
}) {
	const loadedFiles = vault.getAllLoadedFiles();
	const reserved = new ReservedPaths(loadedFiles);
	// A name that occurs anywhere in the vault, which is a different question
	// from a taken path: it is what decides whether a link has to carry a path
	// to say which of them it means.
	const ambiguousNames = new Set<string>(
		loadedFiles.map((file) => file.name.toLowerCase())
	);

	if (parentsInSubfolders) {
		moveParentsToSubfolders(info);
	}

	cleanDuplicateNotes({
		info,
		targetFolderPath,
		reserved,
		ambiguousNames,
	});

	cleanDuplicateAttachments({
		info,
		targetFolderPath,
		reserved,
		ambiguousNames,
	});
}

function cleanDuplicateNotes({
	info,
	targetFolderPath,
	reserved,
	ambiguousNames,
}: {
	info: NotionResolverInfo;
	targetFolderPath: string;
	reserved: ReservedPaths;
	ambiguousNames: Set<string>;
}) {
	for (let fileInfo of Object.values(info.idsToFileInfo)) {
		const parentPath = `${targetFolderPath}${info.getPathForFile(fileInfo)}`;
		const fileName = reserved.take(parentPath, `${fileInfo.title}.md`);

		fileInfo.title = fileName.slice(0, -'.md'.length);

		if (ambiguousNames.has(fileName.toLowerCase())) {
			fileInfo.fullLinkPathNeeded = true;
		}

		ambiguousNames.add(fileName.toLowerCase());
	}
}

function moveParentsToSubfolders(info: NotionResolverInfo) {
	const notesByLastParent = new Set(
		Object.values(info.idsToFileInfo).map(info => info.parentIds)
			.concat(Object.values(info.pathsToAttachmentInfo).map(info => info.parentIds))
			.map((parentIds) => parentIds.length > 0 ? parentIds[parentIds.length - 1] : '')
	);
	for (let id of Object.keys(info.idsToFileInfo)) {
		if (notesByLastParent.has(id)) {
			// Nest any notes with children under the same subfolder, this supports Folder Note plugins in Obsidian
			info.idsToFileInfo[id].parentIds.push(id);
		}
	}
}

function cleanDuplicateAttachments({
	info,
	targetFolderPath,
	reserved,
	ambiguousNames,
}: {
	info: NotionResolverInfo;
	targetFolderPath: string;
	reserved: ReservedPaths;
	ambiguousNames: Set<string>;
}) {
	let attachmentFolderPath = info.attachmentPath;
	let attachmentsInCurrentFolder = /^\.\//.test(attachmentFolderPath);
	// Obsidian formatting for attachments in subfolders is ./<folder>
	let attachmentSubfolder = attachmentFolderPath.match(/\.\/(.*)/)?.[1];

	for (let attachmentInfo of Object.values(info.pathsToAttachmentInfo)) {
		let parentFolderPath = '';
		if (attachmentsInCurrentFolder) {
			parentFolderPath = normalizePath(
				`${targetFolderPath}${info.getPathForFile(attachmentInfo)}${attachmentSubfolder ?? ''}`
			);
		}
		else {
			parentFolderPath = normalizePath(attachmentFolderPath + '/');
		}
		if (!parentFolderPath.endsWith('/')) parentFolderPath += '/';

		// From the name it already carries, which parse-info decoded and
		// sanitized. Rebuilding it from the path in the zip, as this used to,
		// brings back the percent-encoding that name exists to undo.
		attachmentInfo.nameWithExtension = reserved.take(parentFolderPath, attachmentInfo.nameWithExtension);
		attachmentInfo.targetParentFolder = parentFolderPath;

		if (ambiguousNames.has(attachmentInfo.nameWithExtension.toLowerCase())) {
			attachmentInfo.fullLinkPathNeeded = true;
		}

		ambiguousNames.add(attachmentInfo.nameWithExtension.toLowerCase());
	}
}
