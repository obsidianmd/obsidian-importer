import { moment } from 'obsidian';
import { fs } from '../../../filesystem';
import { MetaData } from '../models/MetaData';
import { yarleOptions } from '../yarle';
import { escapeStringRegexp } from './escape-string-regexp';
import { Note } from '../schemas/note';
import { Resource } from '../schemas/resource';

export const getMetadata = (note: Note, notebookName: string): MetaData => {
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

export const getTitle = (note: Note): string => {
	return note.title ? `# ${note.title}` : '';
};

export const getCreationTime = (note: Note): string => {
	return !yarleOptions.skipCreationTime && note.created
		? moment(note.created).format(yarleOptions.dateFormat)
		: '';
};

export const getUpdateTime = (note: Note): string => {
	return !yarleOptions.skipUpdateTime && note.updated
		? moment(note.updated).format(yarleOptions.dateFormat)
		: '';
};

export const getSourceUrl = (note: Note): string | undefined => {
	return !yarleOptions.skipSourceUrl &&
	note['note-attributes']
		? note['note-attributes']['source-url']
		: '';
};

export const getLatLong = (note: Note): string => {
	return !yarleOptions.skipLocation &&
	note['note-attributes']?.longitude
		? `${note['note-attributes'].latitude},${note['note-attributes'].longitude}`
		: '';
};
export const getReminderTime = (note: Note): string => {
	return !yarleOptions.skipReminderTime &&
	note['note-attributes']?.['reminder-time']
		? moment(note['note-attributes']['reminder-time']).format(yarleOptions.dateFormat)
		: '';
};
export const getReminderOrder = (note: Note): string => {
	return !yarleOptions.skipReminderOrder &&
	note['note-attributes']?.['reminder-order']
		? note['note-attributes']['reminder-order']
		: '';
};
export const getReminderDoneTime = (note: Note): string => {
	return !yarleOptions.skipReminderDoneTime &&
	note['note-attributes']?.['reminder-done-time']
		? moment(note['note-attributes']['reminder-done-time']).format(yarleOptions.dateFormat)
		: '';
};
/*
<reminder-order>
<reminder-time>
<reminder-done-time> */
export const getTags = (note: Note): { tags: string } => {
	return { tags: logTags(note) };

};

export const logTags = (note: Note): string => {
	if (!yarleOptions.skipTags && note.tag) {
		const tagArray = Array.isArray(note.tag) ? note.tag : [note.tag];
		const tagOptions = yarleOptions.nestedTags;

		const tags = tagArray.map((tag: string) => {
			let cleanTag = tag
				.toString()
				.replace(/^#/, '');
			if (tagOptions) {
				cleanTag = cleanTag.replace(new RegExp(escapeStringRegexp(tagOptions.separatorInEN), 'g'), tagOptions.replaceSeparatorWith);
			}

			const replaceSpaceWith = tagOptions?.replaceSpaceWith || '-';

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

export const setFileDates = (path: string, note: Note): void => {
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

export const getTimeStampMoment = (resource: Resource): moment.Moment => {
	return resource['resource-attributes']?.['timestamp']
		? moment(resource['resource-attributes']['timestamp'])
		: moment();
};
