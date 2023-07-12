import { NoteData } from '../../../models/NoteData';

import { applyTemplateOnBlock } from './apply-template-on-block';
import * as P from './../placeholders/title-placeholders';
import { getTemplateBlockSettings } from './get-templateblock-settings';

export const applyTitleTemplate = (noteData: NoteData, inputText: string, check: Function): string => {
  const titleTemplateSettings = getTemplateBlockSettings(inputText, check, P, noteData.title);

  return applyTemplateOnBlock(titleTemplateSettings);
};
