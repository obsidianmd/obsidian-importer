import { EvernoteNote, EvernoteResource } from '../models/EvernoteNote';
import { moment } from 'obsidian';
import { fs } from '../../../filesystem';
import { MetaData } from '../models/MetaData';
import { EvernoteRun } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';

export const getMetadata = (run: EvernoteRun, note: EvernoteNote): MetaData => {
	return {
		sourceUrl: getSourceUrl(note),
		reminderTime: getReminderTime(run, note),
		reminderDoneTime: getReminderDoneTime(run, note),
	};
};

export const getSourceUrl = (note: EvernoteNote): string => {
	return note['note-attributes']
		? note['note-attributes']['source-url'] ?? ''
		: '';
};

export const getReminderTime = (run: EvernoteRun, note: EvernoteNote): string => {
	return note['note-attributes'] &&
	note['note-attributes']['reminder-time']
		? moment(note['note-attributes']['reminder-time']).format(run.options.dateFormat)
		: '';
};
export const getReminderDoneTime = (run: EvernoteRun, note: EvernoteNote): string => {
	return note['note-attributes'] &&
	note['note-attributes']['reminder-done-time']
		? moment(note['note-attributes']['reminder-done-time']).format(run.options.dateFormat)
		: '';
};
export const getTags = (run: EvernoteRun, note: EvernoteNote): { tags: string } => {
	return { tags: logTags(run, note) };

};

export const logTags = (run: EvernoteRun, note: EvernoteNote): string => {
	if (note.tag) {
		const tagArray = Array.isArray(note.tag) ? note.tag : [note.tag];
		const tagOptions = run.options.nestedTags;

		const tags = tagArray.map(tag => {
			let cleanTag = tag
				.toString()
				.replace(/^#/, '');
			if (tagOptions) {
				cleanTag = cleanTag.replace(new RegExp(escapeStringRegexp(tagOptions.separatorInEN), 'g'), tagOptions.replaceSeparatorWith);
			}

			const replaceSpaceWith = (tagOptions && tagOptions.replaceSpaceWith) || '-';

			cleanTag = cleanTag.replace(/ /g, replaceSpaceWith);

			return `${run.options.useHashTags ? '#' : ''}${cleanTag}`;
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
