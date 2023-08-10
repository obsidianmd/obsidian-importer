import { NoteData } from '../../../models/NoteData';
import * as P from '../placeholders/title-placeholders';

import { applyTemplateOnBlock } from './apply-template-on-block';
import { getTemplateBlockSettings } from './get-templateblock-settings';

export const applyTitleTemplate = (noteData: NoteData, inputText: string, check: Function): string => {
	const titleTemplateSettings = getTemplateBlockSettings(inputText, check, P, noteData.title);

	return applyTemplateOnBlock(titleTemplateSettings);
};
