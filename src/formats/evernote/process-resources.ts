import { EvernoteNote, EvernoteResource, joinNoteContent } from './models/EvernoteNote';
import { nodeCrypto } from '../../filesystem';
import { base64ToArrayBuffer, moment } from 'obsidian';
import { stringToUtf8 } from '../../util';

import { ResourceHashItem } from './models/ResourceHash';
import { EvernoteRun } from './run';
import * as utils from './utils';

/** When the note says it was made and last changed, for what came out of it. */
const noteTimes = (note: EvernoteNote) => ({
	ctime: moment(note.created).valueOf() || undefined,
	mtime: moment(note.updated).valueOf() || undefined,
});

export const processResources = (run: EvernoteRun, note: EvernoteNote): string => {
	let resourceHashes: Record<string, ResourceHashItem> = {};
	let updatedContent = joinNoteContent(note.content);

	const resources = Array.isArray(note.resource) ? note.resource
		: note.resource ? [note.resource]
			: [];
	for (const resource of resources) {
		resourceHashes = {
			...resourceHashes,
			...processResource(run, resource),
		};
	}

	for (const hash of Object.keys(resourceHashes)) {
		updatedContent = addMediaReference(updatedContent, resourceHashes, hash);
	}

	return updatedContent;
};

const addMediaReference = (content: string, resourceHashes: Record<string, ResourceHashItem>, hash: string): string => {
	const entry = resourceHashes[hash];
	if (!entry) return content;

	const { fileName, src } = entry;
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

const processResource = (run: EvernoteRun, resource: EvernoteResource): Record<string, ResourceHashItem> => {
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
	const fileName = utils.getResourceFileName(resource);

	const bytes = base64ToArrayBuffer(data);
	const src = run.draftResource(fileName, bytes, { mtime: accessTime.valueOf() });

	const recognisedHash = resource.recognition?.match(/[a-f0-9]{32}/)?.[0];

	if (recognisedHash && fileName) {
		resourceHash[recognisedHash] = { fileName, src, alreadyUsed: false };
	}
	else {
		let hash = nodeCrypto.createHash('md5');
		hash.update(new Uint8Array(bytes));
		const md5Hash = hash.digest('hex');
		resourceHash[md5Hash] = { fileName, src, alreadyUsed: false };
	}

	return resourceHash;
};

export const extractDataUrlResources = (
	run: EvernoteRun,
	note: EvernoteNote,
	content: string,
): string => {
	if (content.indexOf('src="data:') < 0) {
		return content; // no data urls
	}

	// src="data:image/svg+xml;base64,..." --> src="<the attachment it becomes>"
	return content.replace(/src="data:([^;,]*)(;base64)?,([^"]*)"/g, (match, mediatype, encoding, data) => {
		return `src="${createResourceFromData(run, mediatype, encoding === ';base64', data, note)}"`;
	});
};

/** Returns what the markdown should say where the data url was. */
const createResourceFromData = (
	run: EvernoteRun,
	mediatype: string,
	base64: boolean,
	data: string,
	note: EvernoteNote,
): string => {
	const baseName = 'embedded'; // data doesn't seem to include useful base filename
	const extension = extensionForMimeType(mediatype) || '.dat';

	const bytes = base64 ? base64ToArrayBuffer(data) : stringToUtf8(decodeURIComponent(data));

	return run.draftResource(`${baseName}.${extension}`, bytes, noteTimes(note));
};

const extensionForMimeType = (mediatype: string): string => {
	// image/jpeg or image/svg+xml or audio/wav or ...
	const subtype = mediatype.split('/').pop()!; // jpeg or svg+xml or wav

	return subtype.split('+')[0]; // jpeg or svg or wav
};
