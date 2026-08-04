import { EvernoteNote, EvernoteResource, joinNoteContent } from './models/EvernoteNote';
import { fs, nodeCrypto, path } from '../../filesystem';

import { ResourceHashItem } from './models/ResourceHash';
import * as utils from './utils';
import { yarleOptions } from './yarle';

const getResourceWorkDirs = (note: EvernoteNote) => {
	const pathSepRegExp = new RegExp(`\\${path.sep}`, 'g');
	const relativeResourceWorkDir = utils.getRelativeResourceDir(note).replace(pathSepRegExp, yarleOptions.pathSeparator || '/');
	const absoluteResourceWorkDir = utils.getAbsoluteResourceDir(note); // .replace(pathSepRegExp,yarleOptions.pathSeparator)

	return { absoluteResourceWorkDir, relativeResourceWorkDir };
};

export const processResources = (note: EvernoteNote): string => {
	let resourceHashes: Record<string, ResourceHashItem> = {};
	let updatedContent = joinNoteContent(note.content);
	const { absoluteResourceWorkDir, relativeResourceWorkDir } = getResourceWorkDirs(note);



	utils.clearResourceDir(note);
	// One resource comes back as an object, several as an array, none as nothing
	const resources = Array.isArray(note.resource) ? note.resource
		: note.resource ? [note.resource]
			: [];
	for (const resource of resources) {
		resourceHashes = {
			...resourceHashes,
			...processResource(absoluteResourceWorkDir, resource),
		};
	}

	for (const hash of Object.keys(resourceHashes)) {
		updatedContent = addMediaReference(updatedContent, resourceHashes, hash, relativeResourceWorkDir);
	}

	return updatedContent;
};

const addMediaReference = (content: string, resourceHashes: Record<string, ResourceHashItem>, hash: string, workDir: string): string => {
	// A resource with no file name cannot be linked to, so the content is left
	// as it is rather than building a reference to nothing.
	const fileName = resourceHashes[hash]?.fileName;
	if (!fileName) return content;

	const src = `${workDir}${yarleOptions.pathSeparator}${fileName.replace(/ /g, ' ')}`;
	let updatedContent: string;
	const replace = `<en-media ([^>]*)hash="${hash}".([^>]*)>`;
	const re = new RegExp(replace, 'g');
	const matchedElements = content.match(re);

	const mediaType = matchedElements && matchedElements.length > 0 && matchedElements[0].split('type=');
	if (mediaType && mediaType.length > 1 && mediaType[1].startsWith('"image')) {
		const width = matchedElements[0].match(/width="(\w+)"/);
		const widthParam = width ? ` width="${width[1]}"` : '';

		const height = matchedElements[0].match(/height="(\w+)"/);
		const heightParam = height ? ` height="${height[1]}"` : '';

		updatedContent = content.replace(re, `<img src="${src}"${widthParam}${heightParam} alt="${fileName}">`);
	}
	else {
		updatedContent = content.replace(re, `<a href="${src}" type="file">${fileName}</a>`);
	}

	return updatedContent;
};

const processResource = (workDir: string, resource: EvernoteResource): Record<string, ResourceHashItem> => {
	const resourceHash: Record<string, ResourceHashItem> = {};

	// Check if resource data exists
	if (!resource.data || !resource.data.$text) {
		console.warn('Resource data is missing or empty, skipping resource:', resource);
		return resourceHash;
	}

	const data = resource.data.$text;

	// Skip unknown type as we don't know how to handle
	// Source: https://dev.evernote.com/doc/articles/data_structure.php
	// "The default type "application/octet-stream" should be used if a more specific type is not known."
	// Update: 
	// In case of unknown files Evernote does the same base64 encoding and put its MD5 hash into the note as reference
	// https://discussion.evernote.com/forums/topic/146906-how-does-evernote-map-the-image-resources-in-enex-file/?do=findComment&comment=692209
	// so I comment out the following exlusion of octet-streams, to fix issue: https://github.com/obsidianmd/obsidian-importer/issues/201
	/*if (resource.mime === 'application/octet-stream') {
		return resourceHash;
	}*/

	const accessTime = utils.getTimeStampMoment(resource);
	const resourceFileProps = utils.getResourceFileProperties(workDir, resource);
	let fileName = resourceFileProps.fileName;

	const absFilePath = `${workDir}${path.sep}${fileName}`;

	let buffer = Buffer.from(data, 'base64');
	fs.writeFileSync(absFilePath, buffer);

	const atime = accessTime.valueOf() / 1000;
	try {
		fs.utimesSync(absFilePath, atime, atime);
	}
	catch {
		// Timestamps are best effort; the resource is already written
	}

	// Evernote's OCR text carries the resource's md5, which is what en-media
	// references it by. Take the match itself: the whole match array used to be
	// used as the key, which stringified to the hash by luck when there was one
	// and to "null" when there was not, leaving the attachment unreferenced.
	const recognisedHash = resource.recognition?.match(/[a-f0-9]{32}/)?.[0];

	if (recognisedHash && fileName) {
		resourceHash[recognisedHash] = { fileName, alreadyUsed: false } as ResourceHashItem;
	}
	else {
		let hash = nodeCrypto.createHash('md5');
		hash.update(buffer);
		const md5Hash = hash.digest('hex');
		resourceHash[md5Hash] = { fileName, alreadyUsed: false } as ResourceHashItem;
	}

	return resourceHash;
};

export const extractDataUrlResources = (
	note: EvernoteNote,
	content: string,
): string => {
	if (content.indexOf('src="data:') < 0) {
		return content; // no data urls
	}

	const { absoluteResourceWorkDir, relativeResourceWorkDir } = getResourceWorkDirs(note);
	fs.mkdirSync(absoluteResourceWorkDir, { recursive: true });

	// src="data:image/svg+xml;base64,..." --> src="resourceDir/fileName"
	return content.replace(/src="data:([^;,]*)(;base64)?,([^"]*)"/g, (match, mediatype, encoding, data) => {
		const fileName = createResourceFromData(mediatype, encoding === ';base64', data, absoluteResourceWorkDir, note);
		const src = `${relativeResourceWorkDir}${yarleOptions.pathSeparator}${fileName}`;

		return `src="${src}"`;
	});
};

// returns filename of new resource
const createResourceFromData = (
	mediatype: string,
	base64: boolean,
	data: string,
	absoluteResourceWorkDir: string,
	note: EvernoteNote,
): string => {
	const baseName = 'embedded'; // data doesn't seem to include useful base filename
	const extension = extensionForMimeType(mediatype) || '.dat';
	const index = utils.getFileIndex(absoluteResourceWorkDir, baseName);
	const fileName = index < 1 ? `${baseName}.${extension}` : `${baseName}.${index}.${extension}`;
	const absFilePath = `${absoluteResourceWorkDir}${path.sep}${fileName}`;

	if (!base64) {
		data = decodeURIComponent(data);
	}

	fs.writeFileSync(absFilePath, data, base64 ? 'base64' : undefined);
	utils.setFileDates(absFilePath, note);


	return fileName;
};

const extensionForMimeType = (mediatype: string): string => {
	// image/jpeg or image/svg+xml or audio/wav or ...
	const subtype = mediatype.split('/').pop()!; // jpeg or svg+xml or wav

	return subtype.split('+')[0]; // jpeg or svg or wav
};
