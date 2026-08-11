import { EvernoteNote, EvernoteResource } from '../models/EvernoteNote';
import { moment } from 'obsidian';
import { fs } from '../../../filesystem';
import { MetaData } from '../models/MetaData';
import { evernoteOptions } from '../convert';
import { escapeStringRegexp } from './escape-string-regexp';

export const getMetadata = (note: EvernoteNote): MetaData => {
	return {
		sourceUrl: getSourceUrl(note),
		reminderTime: getReminderTime(note),
		reminderDoneTime: getReminderDoneTime(note),
	};
};

export const getSourceUrl = (note: EvernoteNote): string => {
	return note['note-attributes']
		? note['note-attributes']['source-url'] ?? ''
		: '';
};

export const getReminderTime = (note: EvernoteNote): string => {
	return note['note-attributes'] &&
	note['note-attributes']['reminder-time']
		? moment(note['note-attributes']['reminder-time']).format(evernoteOptions.dateFormat)
		: '';
};
export const getReminderDoneTime = (note: EvernoteNote): string => {
	return note['note-attributes'] &&
	note['note-attributes']['reminder-done-time']
		? moment(note['note-attributes']['reminder-done-time']).format(evernoteOptions.dateFormat)
		: '';
};
export const getTags = (note: EvernoteNote): { tags: string } => {
	return { tags: logTags(note) };

};

export const logTags = (note: EvernoteNote): string => {
	if (note.tag) {
		const tagArray = Array.isArray(note.tag) ? note.tag : [note.tag];
		const tagOptions = evernoteOptions.nestedTags;

		const tags = tagArray.map(tag => {
			let cleanTag = tag
				.toString()
				.replace(/^#/, '');
			if (tagOptions) {
				cleanTag = cleanTag.replace(new RegExp(escapeStringRegexp(tagOptions.separatorInEN), 'g'), tagOptions.replaceSeparatorWith);
			}

			const replaceSpaceWith = (tagOptions && tagOptions.replaceSpaceWith) || '-';

			cleanTag = cleanTag.replace(/ /g, replaceSpaceWith);

			return `${evernoteOptions.useHashTags ? '#' : ''}${cleanTag}`;
		});

		return tags.join(' ');
	}

	return '';
};

let btime: { btime(path: string, creationTime: number): void } | undefined;
try {
	btime = window.require('btime');
}
catch {
	// The optional module is not installed.
}

export const setFileDates = (path: string, note: EvernoteNote): void => {
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
	catch {
		// The note is already written; timestamps are best effort.
	}
};

export const getTimeStampMoment = (resource: EvernoteResource): moment.Moment => {
	return resource['resource-attributes'] &&
	resource['resource-attributes']['timestamp']
		? moment(resource['resource-attributes']['timestamp'])
		: moment();
};
