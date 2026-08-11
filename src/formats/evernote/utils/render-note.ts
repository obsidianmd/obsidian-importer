import { NoteData } from '../models/NoteData';
import { serializeFrontMatter } from '../../../util';

export const renderNote = (noteData: NoteData): string => {
	const properties: Record<string, unknown> = {};

	if (noteData.tags) properties.tags = noteData.tags.split(' ').map(tag => tag.replace(/^#/, ''));
	if (noteData.sourceUrl) properties.source = noteData.sourceUrl;
	if (noteData.reminderTime) properties.reminder = noteData.reminderTime;
	if (noteData.reminderDoneTime) properties['reminder-done'] = noteData.reminderDoneTime;

	return `${serializeFrontMatter(properties)}${noteData.content}\n`;
};
