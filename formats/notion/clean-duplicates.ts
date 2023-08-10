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
	for (let fileInfo of Object.values(info.idsToFileInfo)) {
		let path = info.getPathForFile(fileInfo);

		if (pathDuplicateChecks.has(`${path}${fileInfo.title}`)) {
			let duplicateResolutionIndex = 2;
			fileInfo.title = fileInfo.title + ' ' + duplicateResolutionIndex;
			while (pathDuplicateChecks.has(`${path}${fileInfo.title}`)) {
				duplicateResolutionIndex++;
				fileInfo.title = `${fileInfo.title.replace(/ \d+$/, '')} ${duplicateResolutionIndex}`;
			}
		}

		if (titleDuplicateChecks.has(fileInfo.title + '.md')) {
			fileInfo.fullLinkPathNeeded = true;
		}

		pathDuplicateChecks.add(`${path}${fileInfo.title}`);
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
			parentFolderPath = normalizePath(attachmentFolderPath + '/');
		}
		if (!parentFolderPath.endsWith('/')) parentFolderPath += '/';

		if (attachmentPaths.has(parentFolderPath + attachmentInfo.nameWithExtension)) {
			let duplicateResolutionIndex = 2;
			const { basename, extension } = parseFilePath(attachmentInfo.path);
			while (attachmentPaths.has(
				`${parentFolderPath}${basename} ${duplicateResolutionIndex}.${extension}`
			)) {
				duplicateResolutionIndex++;
			}
			attachmentInfo.nameWithExtension = `${basename} ${duplicateResolutionIndex}.${extension}`;
		}

		attachmentInfo.targetParentFolder = parentFolderPath;

		attachmentPaths.add(parentFolderPath + attachmentInfo.nameWithExtension);
		titleDuplicateChecks.add(attachmentInfo.nameWithExtension);
	}
}
