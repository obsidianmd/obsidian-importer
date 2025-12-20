import * as T from '../placeholders/title-placeholders';

import { removePlaceholder } from './remove-placeholder';

export const removeTitlePlaceholder = (text: string): string => {
	return removePlaceholder(text, T);
};
