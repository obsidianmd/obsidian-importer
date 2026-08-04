import { TemplateBlockSettings, TemplateBlockCheck } from '../template-settings';

export const getTemplateBlockSettings = (text: string, check: TemplateBlockCheck, T: any, value?: string): TemplateBlockSettings => {
	return {
		template: text,
		check,
		startBlockPlaceholder: T.START_BLOCK,
		endBlockPlaceholder: T.END_BLOCK,
		valuePlaceholder: T.CONTENT_PLACEHOLDER,
		value,
	};
};
