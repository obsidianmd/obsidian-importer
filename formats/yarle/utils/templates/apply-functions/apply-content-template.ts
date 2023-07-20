import { NoteData } from '../../../models/NoteData';
import * as P from '../placeholders/content-placeholders';

import { applyTemplateOnBlock } from './apply-template-on-block';
import { getTemplateBlockSettings } from './get-templateblock-settings';

export const applyContentTemplate = (noteData: NoteData, inputText: string, check: Function): string => {
	const contentTemplateSettings = getTemplateBlockSettings(inputText, check, P, noteData.content);

	return applyTemplateOnBlock(contentTemplateSettings);
};
