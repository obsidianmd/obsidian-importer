import { normalizePath, TAbstractFile, Vault } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { NotionResolverInfo } from './notion-types';

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
	const pathDuplicateChecks = new Set<string>();
	const titleDuplicateChecks = new Set<string>(
		loadedFiles.map((file) => file.name)
	);

	if (parentsInSubfolders) {
		moveParentsToSubfolders(info);
	}

	cleanDuplicateNotes({
		info,
		pathDuplicateChecks,
		titleDuplicateChecks,
	});

	cleanDuplicateAttachments({
		info,
		loadedFiles,
		titleDuplicateChecks,
		targetFolderPath,
	});
}

function cleanDuplicateNotes({
	info,
	pathDuplicateChecks,
	titleDuplicateChecks,
}: {
	info: NotionResolverInfo;
	pathDuplicateChecks: Set<string>;
	titleDuplicateChecks: Set<string>;
}) {
	// Use case-insensitive checks to handle filesystems like Windows/macOS
	// that treat "Getting started.md" and "Getting Started.md" as the same file.
	const pathDuplicateChecksLower = new Set<string>();

	for (let [id, fileInfo] of Object.entries(info.idsToFileInfo)) {
		let path = info.getPathForFile(fileInfo);
		const fullPathLower = `${path}${fileInfo.title}`.toLowerCase();

		if (pathDuplicateChecksLower.has(fullPathLower)) {
			// Case-insensitive collision: append first 4 chars of Notion ID
			fileInfo.title = `${fileInfo.title}_${id.slice(0, 4)}`;

			// If still collides (unlikely), keep appending more of the ID
			let idLen = 4;
			while (pathDuplicateChecksLower.has(`${path}${fileInfo.title}`.toLowerCase())) {
				idLen = Math.min(idLen + 4, id.length);
				fileInfo.title = `${fileInfo.title.replace(/_[a-z0-9]+$/, '')}_${id.slice(0, idLen)}`;
			}
		}

		if (titleDuplicateChecks.has(fileInfo.title + '.md')) {
			fileInfo.fullLinkPathNeeded = true;
		}

		pathDuplicateChecks.add(`${path}${fileInfo.title}`);
		pathDuplicateChecksLower.add(`${path}${fileInfo.title}`.toLowerCase());
		titleDuplicateChecks.add(fileInfo.title + '.md');
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
	loadedFiles,
	titleDuplicateChecks,
	targetFolderPath,
}: {
	info: NotionResolverInfo;
	loadedFiles: TAbstractFile[];
	titleDuplicateChecks: Set<string>;
	targetFolderPath: string;
}) {
	const attachmentPaths = new Set(
		loadedFiles
			.filter((file) => !file.path.endsWith('.md'))
			.map((file) => file.path)
	);
	// Case-insensitive set for Windows/macOS filesystem collision detection
	const attachmentPathsLower = new Set(
		[...attachmentPaths].map((p) => p.toLowerCase())
	);

	let attachmentFolderPath = info.attachmentPath;
	let attachmentsInCurrentFolder = /^\.\//.test(attachmentFolderPath);
	// Obsidian formatting for attachments in subfolders is ./<folder>
	let attachmentSubfolder = attachmentFolderPath.match(/\.\/(.*)/)?.[1];

	for (let attachmentInfo of Object.values(info.pathsToAttachmentInfo)) {
		if (titleDuplicateChecks.has(attachmentInfo.nameWithExtension)) {
			attachmentInfo.fullLinkPathNeeded = true;
		}

		let parentFolderPath = '';
		if (attachmentsInCurrentFolder) {
			parentFolderPath = normalizePath(
				`${targetFolderPath}${info.getPathForFile(attachmentInfo)}${attachmentSubfolder ?? ''}`
			);
		}
		else {
			const basePath = attachmentFolderPath && attachmentFolderPath !== '/'
				? attachmentFolderPath + '/'
				: targetFolderPath;
			parentFolderPath = normalizePath(basePath + info.getPathForFile(attachmentInfo));
		}
		if (!parentFolderPath.endsWith('/')) parentFolderPath += '/';

		// Use case-insensitive check for filesystems like Windows/macOS
		if (attachmentPathsLower.has((parentFolderPath + attachmentInfo.nameWithExtension).toLowerCase())) {
			let duplicateResolutionIndex = 2;
			const { basename, extension } = parseFilePath(attachmentInfo.path);
			while (attachmentPathsLower.has(
				`${parentFolderPath}${basename} ${duplicateResolutionIndex}.${extension}`.toLowerCase()
			)) {
				duplicateResolutionIndex++;
			}
			attachmentInfo.nameWithExtension = `${basename} ${duplicateResolutionIndex}.${extension}`;
		}

		attachmentInfo.targetParentFolder = parentFolderPath;

		attachmentPaths.add(parentFolderPath + attachmentInfo.nameWithExtension);
		attachmentPathsLower.add((parentFolderPath + attachmentInfo.nameWithExtension).toLowerCase());
		titleDuplicateChecks.add(attachmentInfo.nameWithExtension);
	}
}
