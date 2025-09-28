import { CheckFunction, TemplateBlockSettings } from '../template-settings';
import { PlaceholderItem } from '../types';

export const getTemplateBlockSettings = (text: string, check: CheckFunction, T: PlaceholderItem, value?: string): TemplateBlockSettings => {
	return {
		template: text,
		check,
		startBlockPlaceholder: T.START_BLOCK,
		endBlockPlaceholder: T.END_BLOCK,
		valuePlaceholder: T.CONTENT_PLACEHOLDER,
		value,
	};
};
