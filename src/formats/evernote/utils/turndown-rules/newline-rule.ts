import { TurndownNode } from './turndown-types';
import { filterByNodeName } from './filter-by-nodename';

export const newLineRule = {
	filter: filterByNodeName('BR'),
	replacement: (content: string, node: TurndownNode) => {
		return '<ENEX_NEWLINE_PLACEHOLDER>';
	},
};
