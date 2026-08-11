import { EvernoteNote, EvernoteResource, joinNoteContent } from './models/EvernoteNote';
import { base64ToArrayBuffer } from 'obsidian';
import { stringToUtf8 } from '../../util';

import { ResourceHashItem } from './models/ResourceHash';
import { EvernoteRun } from './run';
import { md5 } from './utils/md5';
import { noteTimes } from './utils/note-times';
import * as utils from './utils';

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
		// One image can be placed several times at several sizes, so each
		// reference is measured on its own rather than from the first of them.
		updatedContent = content.replace(re, media =>
			`<img src="${src}"${sizeAttribute(media, 'width')}${sizeAttribute(media, 'height')} alt="${fileName}">`);
	}
	else {
		updatedContent = content.replace(re, `<a href="${src}" type="file">${fileName}</a>`);
	}

	return updatedContent;
};

/**
 * The size Evernote drew the image at, which it writes in fractional pixels:
 * width="61.8812255859375px".
 *
 * A style sizing the image is what the note was drawn from, and it wins over
 * the attribute the way it does in a browser. A web clip carries a meaningless
 * `width="1"` beside `width:auto`, and honouring that shrinks the image to a dot.
 */
const sizeAttribute = (media: string, dimension: 'width' | 'height'): string => {
	if (new RegExp(`style="[^"]*[;"\\s]${dimension}\\s*:\\s*auto`, 'i').test(media)) return '';

	const size = media.match(new RegExp(`\\s${dimension}="([^"]+)"`));

	return size ? ` ${dimension}="${size[1]}"` : '';
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
		resourceHash[recognisedHash] = { fileName, src };
	}
	else {
		resourceHash[md5(new Uint8Array(bytes))] = { fileName, src };
	}

	return resourceHash;
};

export const extractDataUrlResources = (
	run: EvernoteRun,
	note: EvernoteNote,
	content: string,
): string => {
	if (content.indexOf('src="data:') < 0) {
		return content;
	}

	return content.replace(/src="data:([^;,]*)(;base64)?,([^"]*)"/g, (match, mediatype, encoding, data) => {
		return `src="${createResourceFromData(run, mediatype, encoding === ';base64', data, note)}"`;
	});
};

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
