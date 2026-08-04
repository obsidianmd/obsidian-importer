import { TurndownNode } from './turndown-types';
export const getAttributeProxy = (node: TurndownNode): any => {
	const handler = {
		get(target: any, key: any): any {
			return target[key];
		},
	};

	return new Proxy(node.attributes, handler);
};
