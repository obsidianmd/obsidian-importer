import { EvernoteNote } from '../models/EvernoteNote';
export const isComplex = (note: EvernoteNote): boolean => {
	return note.resource ? true : false;
};

export const isWebClip = (note: EvernoteNote): boolean => {
	return note['note-attributes']?.['source-application'] === 'webclipper.evernote' ||
		note['note-attributes']?.['source'] === 'web.clip7';
};
