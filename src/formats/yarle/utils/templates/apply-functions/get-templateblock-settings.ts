import { CheckFunction, TemplateBlockSettings } from '../template-settings';

export const getTemplateBlockSettings = (text: string, check: CheckFunction, T: any, value?: string): TemplateBlockSettings => {
	return {
		template: text,
		check,
		startBlockPlaceholder: T.START_BLOCK,
		endBlockPlaceholder: T.END_BLOCK,
		valuePlaceholder: T.CONTENT_PLACEHOLDER,
		value,
	};
};
