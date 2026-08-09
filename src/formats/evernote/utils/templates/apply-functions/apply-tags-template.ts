import { NoteData } from '../../../models/NoteData';
import { TemplateBlockCheck } from '../template-settings';
import * as P from '../placeholders/tags-placeholders';

import { applyTemplateOnBlock } from './apply-template-on-block';
import { getTemplateBlockSettings } from './get-templateblock-settings';

export const applyTagsTemplate = (noteData: NoteData, inputText: string, check: TemplateBlockCheck): string => {
	const tagsTemplateSettings = getTemplateBlockSettings(inputText, check, P, noteData.tags);

	return applyTemplateOnBlock(tagsTemplateSettings);
};
