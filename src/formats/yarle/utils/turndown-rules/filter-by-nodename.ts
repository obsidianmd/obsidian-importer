import { TurndownFilter, TurndownNode } from './turndown-types';
export const filterByNodeName = (nodename: string): TurndownFilter => {
	return (node: TurndownNode): boolean => {
		return node.nodeName === nodename || node.nodeName.toLowerCase() === nodename;
	};
};
