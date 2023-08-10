import { NoteData } from '../../../models/NoteData';
import * as P from '../placeholders/tags-placeholders';

import { applyTemplateOnBlock } from './apply-template-on-block';
import { getTemplateBlockSettings } from './get-templateblock-settings';

export const applyTagsTemplate = (noteData: NoteData, inputText: string, check: Function): string => {
	const tagsTemplateSettings = getTemplateBlockSettings(inputText, check, P, noteData.tags);

	return applyTemplateOnBlock(tagsTemplateSettings);
};
