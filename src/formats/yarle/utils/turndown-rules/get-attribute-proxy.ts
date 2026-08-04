import { TurndownNode } from './turndown-types';

/**
 * A node's attributes, reachable by name.
 *
 * NamedNodeMap is indexed by position, so callers reading nodeProxy.src or
 * nodeProxy.style go through this proxy instead. A name that is not present
 * reads as undefined, which is what those callers check for.
 */
export type AttributeProxy = Record<string, Attr | undefined>;

export const getAttributeProxy = (node: TurndownNode): AttributeProxy => {
	const handler: ProxyHandler<NamedNodeMap> = {
		get(target: NamedNodeMap, key: PropertyKey) {
			return target[key as keyof NamedNodeMap];
		},
	};

	return new Proxy(node.attributes, handler) as unknown as AttributeProxy;
};
