import * as M from '../match-all';
import { TemplateBlockPlaceholders } from '../template-settings';

export const removePlaceholder = (text: string, P: TemplateBlockPlaceholders): string => {
	return text.replace(
		new RegExp(`${P.START_BLOCK}(?<=${P.START_BLOCK})(.*)(?=${P.END_BLOCK})${P.END_BLOCK}${M.MATCH_LF}`,
			'g',
		),
		'',
	);
};
