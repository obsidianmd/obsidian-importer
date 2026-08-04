import { TurndownNode } from './turndown-types';
export const filterByNodeName = (nodename: string): any => {
	return (node: TurndownNode): any => {
		return node.nodeName === nodename || node.nodeName.toLowerCase() === nodename;
	};
};
