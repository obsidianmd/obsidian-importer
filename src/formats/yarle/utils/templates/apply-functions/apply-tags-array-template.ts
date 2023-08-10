import { NoteData } from '../../../models/NoteData';
import * as P from '../placeholders/tags-array-placeholders';

import { applyTemplateOnBlock } from './apply-template-on-block';
import { getTemplateBlockSettings } from './get-templateblock-settings';

export const applyTagsArrayTemplate = (noteData: NoteData, inputText: string, check: Function): string => {
	if (noteData.tags) {
		noteData.tags = JSON.stringify(noteData.tags.split(' '));
	}
	const tagsTemplateSettings = getTemplateBlockSettings(inputText, check, P, noteData.tags);

	return applyTemplateOnBlock(tagsTemplateSettings);
};
