import { TemplateBlockSettings } from '../template-settings';
import { escapeYamlValue } from '../../yaml-utils';

export const applyTemplateOnBlock = ({
	template,
	check,
	startBlockPlaceholder,
	endBlockPlaceholder,
	valuePlaceholder,
	value,
	skipYamlEscaping,
}: TemplateBlockSettings): string => {
	if (value && check()) {
		const finalValue = skipYamlEscaping ? value : escapeYamlValue(value);
		return template
			.replace(new RegExp(`${startBlockPlaceholder}`, 'g'), '')
			.replace(new RegExp(`${endBlockPlaceholder}`, 'g'), '')
			.replace(new RegExp(`${valuePlaceholder}`, 'g'), finalValue);

	}
	const reg = `${startBlockPlaceholder}([\\d\\D])(?:.|(\r\n|\r|\n))*?(?=${endBlockPlaceholder})${endBlockPlaceholder}`;

	return template.replace(
		new RegExp(reg,
			'g',
		),
		'',
	);
};
