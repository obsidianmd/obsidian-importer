import { filterByNodeName } from './filter-by-nodename';
import { defineRule } from './define-rule';

export const newLineRule = defineRule({
	filter: filterByNodeName('BR'),
	replacement: (content, node) => {
		return '<YARLE_NEWLINE_PLACEHOLDER>';
	},
});
