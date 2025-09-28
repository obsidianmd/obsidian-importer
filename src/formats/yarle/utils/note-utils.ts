import { Note } from '../schemas/note';

export const isComplex = (note: Note): boolean => {
	return note.resource !== undefined;
};

export const isWebClip = (note: Note): boolean | undefined => {
	return note['note-attributes'] && (
		note['note-attributes']['source-application'] === 'webclipper.evernote' ||
		note['note-attributes']['source'] === 'web.clip7');
};
