import { FilterFunction } from 'turndown';

export const filterByNodeName = (nodename: string): FilterFunction => {
	return (node): boolean => {
		return node.nodeName === nodename || node.nodeName.toLowerCase() === nodename;
	};
};
