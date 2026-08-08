import { normalizePath, TAbstractFile, Vault } from 'obsidian';
import { availableFileName } from '../../util';
import { NotionResolverInfo } from './notion-types';

class ReservedPaths {
	private taken = new Set<string>();

	constructor(existing: TAbstractFile[]) {
		for (const file of existing) this.add(file.path);
	}

	private add(path: string): void {
		// Default macOS and Windows filesystems are case-insensitive (#223).
		this.taken.add(normalizePath(path).toLowerCase());
	}

	private has(path: string): boolean {
		return this.taken.has(normalizePath(path).toLowerCase());
	}

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
	// Bare wikilinks need a path when a basename appears more than once.
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

		attachmentInfo.nameWithExtension = reserved.take(parentFolderPath, attachmentInfo.nameWithExtension);
		attachmentInfo.targetParentFolder = parentFolderPath;

		if (ambiguousNames.has(attachmentInfo.nameWithExtension.toLowerCase())) {
			attachmentInfo.fullLinkPathNeeded = true;
		}

		ambiguousNames.add(attachmentInfo.nameWithExtension.toLowerCase());
	}
}
