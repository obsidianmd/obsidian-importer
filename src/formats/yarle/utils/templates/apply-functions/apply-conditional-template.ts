import { escapeYamlValue } from '../../yaml-utils';

export const applyConditionalTemplate = (text: string, P: any, newValue?: string): string => {
	const escapedValue = escapeYamlValue(newValue);
	return text
		.replace(new RegExp(`${P.CONTENT_PLACEHOLDER}`, 'g'), escapedValue)
		.replace(new RegExp(`${P.START_BLOCK}`, 'g'), '')
		.replace(new RegExp(`${P.END_BLOCK}`, 'g'), '');
};
