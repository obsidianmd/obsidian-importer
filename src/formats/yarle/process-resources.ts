import crypto from 'crypto';
import { fs, path } from '../../filesystem';

import { ResourceHashItem } from './models/ResourceHash';
import * as utils from './utils';
import { yarleOptions } from './yarle';

const getResourceWorkDirs = (note: any) => {
	const pathSepRegExp = new RegExp(`\\${path.sep}`, 'g');
	const relativeResourceWorkDir = utils.getRelativeResourceDir(note).replace(pathSepRegExp, yarleOptions.pathSeparator || '/');
	const absoluteResourceWorkDir = utils.getAbsoluteResourceDir(note); // .replace(pathSepRegExp,yarleOptions.pathSeparator)

	return { absoluteResourceWorkDir, relativeResourceWorkDir };
};

export const processResources = (note: any): string => {
	let resourceHashes: any = {};
	let updatedContent = note.content;
	const { absoluteResourceWorkDir, relativeResourceWorkDir } = getResourceWorkDirs(note);

	console.log(`relative resource work dir: ${relativeResourceWorkDir}`);

	console.log(`absolute resource work dir: ${absoluteResourceWorkDir}`);

	utils.clearResourceDir(note);
	if (Array.isArray(note.resource)) {
		for (const resource of note.resource) {
			resourceHashes = {
				...resourceHashes,
				...processResource(absoluteResourceWorkDir, resource),
			};
		}
	}
	else {
		resourceHashes = {
			...resourceHashes,
			...processResource(absoluteResourceWorkDir, note.resource),
		};
	}

	for (const hash of Object.keys(resourceHashes)) {
		updatedContent = addMediaReference(updatedContent, resourceHashes, hash, relativeResourceWorkDir);
	}

	return updatedContent;
};

const addMediaReference = (content: string, resourceHashes: any, hash: any, workDir: string): string => {
	const src = `${workDir}${yarleOptions.pathSeparator}${resourceHashes[hash].fileName.replace(/ /g, '\ ')}`;
	console.log(`mediaReference src ${src} added`);
	let updatedContent: any;
	const replace = `<en-media ([^>]*)hash="${hash}".([^>]*)>`;
	const re = new RegExp(replace, 'g');
	const matchedElements = content.match(re);

	const mediaType = matchedElements && matchedElements.length > 0 && matchedElements[0].split('type=');
	if (mediaType && mediaType.length > 1 && mediaType[1].startsWith('"image')) {
		const width = matchedElements[0].match(/width="(\w+)"/);
		const widthParam = width ? ` width="${width[1]}"` : '';

		const height = matchedElements[0].match(/height="(\w+)"/);
		const heightParam = height ? ` height="${height[1]}"` : '';

		updatedContent = content.replace(re, `<img src="${src}"${widthParam}${heightParam} alt="${resourceHashes[hash].fileName}">`);
	}
	else {
		updatedContent = content.replace(re, `<a href="${src}" type="file">${resourceHashes[hash].fileName}</a>`);
	}

	return updatedContent;
};

const processResource = (workDir: string, resource: any): any => {
	const resourceHash: any = {};
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

	console.log(resource);
	console.log(data);
	let buffer = Buffer.from(data, 'base64');
	fs.writeFileSync(absFilePath, buffer);

	const atime = accessTime.valueOf() / 1000;
	try{
		fs.utimesSync(absFilePath, atime, atime);
	}
	catch(e){}

	if (resource.recognition && fileName) {
		const hashIndex = resource.recognition.match(/[a-f0-9]{32}/);
		console.log(`resource ${fileName} added with hash ${hashIndex}`);
		resourceHash[hashIndex as any] = { fileName, alreadyUsed: false } as ResourceHashItem;
	}
	else {
		let hash = crypto.createHash('md5');
		hash.update(buffer);
		const md5Hash = hash.digest('hex');
		resourceHash[md5Hash] = { fileName, alreadyUsed: false } as ResourceHashItem;
	}

	return resourceHash;
};

export const extractDataUrlResources = (
	note: any,
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
	note: any,
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

	console.log(`data url resource ${fileName} added`);

	return fileName;
};

const extensionForMimeType = (mediatype: string): string => {
	// image/jpeg or image/svg+xml or audio/wav or ...
	const subtype = mediatype.split('/').pop()!; // jpeg or svg+xml or wav

	return subtype.split('+')[0]; // jpeg or svg or wav
};
