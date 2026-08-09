import { NoteData } from '../../models/NoteData';

import { EvernoteOptions } from '../../options';
import { applyContentTemplate, applyCreatedAtTemplate, applyLocationTemplate, applyNotebookTemplate, applyReminderDoneTimeTemplate, applyReminderOrderTemplate, applyReminderTimeTemplate, applySourceUrlTemplate,applyTagsYamlListTemplate,  applyTagsTemplate, applyTitleTemplate, applyUpdatedAtTemplate } from './apply-functions';

import * as T from './placeholders/metadata-placeholders';
import { removeCreatedAtPlaceholder, removeLinkToOriginalTemplate, removeLocationPlaceholder, removeNotebookPlaceholder, removeReminderDoneTimePlaceholder, removeReminderOrderPlaceholder, removeReminderTimePlaceholder, removeSourceUrlPlaceholder, removeUpdatedAtPlaceholder } from './remove-functions';

export const applyTemplate = (noteData: NoteData, evernoteOptions: EvernoteOptions) => {

	let result = evernoteOptions.currentTemplate;

	result = applyTitleTemplate(noteData, result, () => noteData.title);
	result = applyTagsTemplate(noteData, result, () => !evernoteOptions.skipTags);
	result = applyTagsYamlListTemplate(noteData, result, () => !evernoteOptions.skipTags);
	result = applyContentTemplate(noteData, result, () => noteData.content);

	result = removeLinkToOriginalTemplate(result);

	result = (!evernoteOptions.skipCreationTime && noteData.createdAt)
		? applyCreatedAtTemplate(noteData, result)
		: removeCreatedAtPlaceholder(result);

	result = (!evernoteOptions.skipUpdateTime && noteData.updatedAt)
		? applyUpdatedAtTemplate(noteData, result)
		: removeUpdatedAtPlaceholder(result);

	result = (!evernoteOptions.skipSourceUrl && noteData.sourceUrl)
		? applySourceUrlTemplate(noteData, result)
		: removeSourceUrlPlaceholder(result);

	result = (!evernoteOptions.skipLocation && noteData.location)
		? applyLocationTemplate(noteData, result)
		: removeLocationPlaceholder(result);

	result = (evernoteOptions.isNotebookNameNeeded && noteData.notebookName)
		? applyNotebookTemplate(noteData, result)
		: removeNotebookPlaceholder(result);

	result = (!evernoteOptions.skipReminderTime && noteData.reminderTime)
		? applyReminderTimeTemplate(noteData, result)
		: removeReminderTimePlaceholder(result);

	result = (!evernoteOptions.skipReminderOrder && noteData.reminderOrder)
		? applyReminderOrderTemplate(noteData, result)
		: removeReminderOrderPlaceholder(result);

	result = (!evernoteOptions.skipReminderDoneTime && noteData.reminderDoneTime)
		? applyReminderDoneTimeTemplate(noteData, result)
		: removeReminderDoneTimePlaceholder(result);

	result = result.replace(T.START_BLOCK, '')
		.replace(T.END_BLOCK, '');

	return result;
};
