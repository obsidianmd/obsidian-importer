import { moment } from 'obsidian';
import { fs } from '../../../filesystem';
import { MetaData } from '../models/MetaData';
import { yarleOptions } from '../yarle';
import { escapeStringRegexp } from './escape-string-regexp';

export const getMetadata = (note: any, notebookName: string): MetaData => {
	return {
		createdAt: getCreationTime(note),
		updatedAt: getUpdateTime(note),
		sourceUrl: getSourceUrl(note),
		location: getLatLong(note),
		reminderTime: getReminderTime(note),
		reminderOrder: getReminderOrder(note),
		reminderDoneTime: getReminderDoneTime(note),
		notebookName,
	};
};

export const getTitle = (note: any): string => {
	return note.title ? `# ${note.title}` : '';
};

export const getCreationTime = (note: any): string => {
	return !yarleOptions.skipCreationTime && note.created
		? moment(note.created).format(yarleOptions.dateFormat)
		: '';
};

export const getUpdateTime = (note: any): string => {
	return !yarleOptions.skipUpdateTime && note.updated
		? moment(note.updated).format(yarleOptions.dateFormat)
		: '';
};

export const getSourceUrl = (note: any): string => {
	return !yarleOptions.skipSourceUrl &&
	note['note-attributes']
		? note['note-attributes']['source-url']
		: '';
};

export const getLatLong = (note: any): string => {
	return !yarleOptions.skipLocation &&
	note['note-attributes'] &&
	note['note-attributes'].longitude
		? `${note['note-attributes'].latitude},${note['note-attributes'].longitude}`
		: '';
};
export const getReminderTime = (note: any): string => {
	return !yarleOptions.skipReminderTime &&
	note['note-attributes'] &&
	note['note-attributes']['reminder-time']
		? moment(note['note-attributes']['reminder-time']).format(yarleOptions.dateFormat)
		: '';
};
export const getReminderOrder = (note: any): string => {
	return !yarleOptions.skipReminderOrder &&
	note['note-attributes'] &&
	note['note-attributes']['reminder-order']
		? note['note-attributes']['reminder-order']
		: '';
};
export const getReminderDoneTime = (note: any): string => {
	return !yarleOptions.skipReminderDoneTime &&
	note['note-attributes'] &&
	note['note-attributes']['reminder-done-time']
		? moment(note['note-attributes']['reminder-done-time']).format(yarleOptions.dateFormat)
		: '';
};
/*
<reminder-order>
<reminder-time>
<reminder-done-time> */
export const getTags = (note: any): { tags: string } => {
	return { tags: logTags(note) };

};

export const logTags = (note: any): string => {
	if (!yarleOptions.skipTags && note.tag) {
		const tagArray = Array.isArray(note.tag) ? note.tag : [note.tag];
		const tagOptions = yarleOptions.nestedTags;

		const tags = tagArray.map((tag: any) => {
			let cleanTag = tag
				.toString()
				.replace(/^#/, '');
			if (tagOptions) {
				cleanTag = cleanTag.replace(new RegExp(escapeStringRegexp(tagOptions.separatorInEN), 'g'), tagOptions.replaceSeparatorWith);
			}

			const replaceSpaceWith = (tagOptions && tagOptions.replaceSpaceWith) || '-';

			cleanTag = cleanTag.replace(/ /g, replaceSpaceWith);

			return `${yarleOptions.useHashTags ? '#' : ''}${cleanTag}`;
		});

		return tags.join(' ');
	}

	return '';
};

let btime: any;
try {
	btime = window.require('btime');
}
catch (e) {}

export const setFileDates = (path: string, note: any): void => {
	// also set creation time if supported
	const creationTime = moment(note.created).valueOf();
	if (creationTime > 0 && btime) {
		btime.btime(path, creationTime);
	}

	const updated = moment(note.updated).valueOf();
	const mtime = updated / 1000;
	try{
		fs.utimesSync(path, mtime, mtime);
	}
	catch (e) {}
};

export const getTimeStampMoment = (resource: any): any => {
	return resource['resource-attributes'] &&
	resource['resource-attributes']['timestamp']
		? moment(resource['resource-attributes']['timestamp'])
		: moment();
};
