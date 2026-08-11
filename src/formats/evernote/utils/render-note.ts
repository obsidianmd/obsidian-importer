import { NoteData } from '../models/NoteData';
import { serializeFrontMatter } from '../../../util';

/**
 * The note as Markdown.
 *
 * Yarle built the properties as text from a template and left it to
 * standardizeFrontMatter to parse them back and write them out properly. The
 * object is built here instead and serialized once, which is how every other
 * importer does it - and what a property carrying a colon, a quote or a
 * leading dash needed, since the template could not escape one.
 */
export const renderNote = (noteData: NoteData): string => {
	const properties: Record<string, unknown> = {};

	if (noteData.tags) properties.tags = noteData.tags.split(' ').map(tag => tag.replace(/^#/, ''));
	if (noteData.sourceUrl) properties.source = noteData.sourceUrl;
	if (noteData.reminderTime) properties.reminder = noteData.reminderTime;
	if (noteData.reminderDoneTime) properties['reminder-done'] = noteData.reminderDoneTime;

	return `${serializeFrontMatter(properties)}${noteData.content}\n`;
};
