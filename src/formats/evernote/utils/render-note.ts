import { NoteData } from '../models/NoteData';

/**
 * The note as Markdown, in the shape Yarle's template engine gave it the one
 * template the importer ever handed it. The spacing is the template's, and is
 * left alone here because `standardizeFrontMatter` is what settles it.
 */
export const renderNote = (noteData: NoteData): string => {
	let properties = '';

	if (noteData.tags) {
		const list = noteData.tags.split(' ').map(tag => `  - ${tag.replace(/^#/, '')}`).join('\n');
		properties += `\ntags: \n${list}\n\n`;
	}
	if (noteData.sourceUrl) properties += `source: ${noteData.sourceUrl}\n`;
	if (noteData.reminderTime) properties += `reminder: ${noteData.reminderTime}\n`;
	if (noteData.reminderDoneTime) properties += `reminder-done: ${noteData.reminderDoneTime}\n`;

	return `---\n${properties}---\n${noteData.content}\n`;
};
