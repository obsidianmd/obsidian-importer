import TurndownService from 'turndown';
import { isElement } from './dom-utils';

export type TrueReplacementFunction = (content: string, node: HTMLElement, options: TurndownService.Options) => string;
export interface TrueRule {
	filter: TurndownService.Filter;
	replacement: TrueReplacementFunction;
}

// Wraps replacement function to ensure node is an element
// NOTE: Remove this wrapper after https://github.com/DefinitelyTyped/DefinitelyTyped/pull/73757 is merged.
// The updated typings will ensure the replacement's node is an HTMLElement.
export const defineRule = ({ filter, replacement }: TrueRule): TurndownService.Rule => {
	return {
		filter,
		replacement: defineRuleReplacement(replacement)
	};
};

export const defineRuleReplacement = (replacement: TrueReplacementFunction): TurndownService.ReplacementFunction => (content, node, options) => {
	if (!isElement(node)) {
		// https://github.com/mixmark-io/turndown/blob/0df0c0506233e0459ba21974f30b9ad3f1feb20f/src/turndown.js#L166
		// As per turndown source code, this case should not happen
		throw new Error('node should be an element');
	}
	return replacement(content, node, options);
};
