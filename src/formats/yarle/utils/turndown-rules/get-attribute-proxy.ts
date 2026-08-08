import { TurndownNode } from './turndown-types';

export type AttributeProxy = Record<string, Attr | undefined>;

export const getAttributeProxy = (node: TurndownNode): AttributeProxy => {
	const handler: ProxyHandler<NamedNodeMap> = {
		get(target: NamedNodeMap, key: PropertyKey) {
			return target[key as keyof NamedNodeMap];
		},
	};

	return new Proxy(node.attributes, handler) as unknown as AttributeProxy;
};
