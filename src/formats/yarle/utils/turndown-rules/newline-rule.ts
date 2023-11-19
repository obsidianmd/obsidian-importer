import { filterByNodeName } from './filter-by-nodename';

export const newLineRule = {
	filter: filterByNodeName('BR'),
	replacement: (content: any, node: any) => {
		return '<YARLE_NEWLINE_PLACEHOLDER>';
	},
};
