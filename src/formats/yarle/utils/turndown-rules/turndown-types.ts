/**
 * Types for the Turndown rules below.
 *
 * Turndown is not a dependency of this plugin - Obsidian provides it as
 * window.TurndownService - so there is nothing to import types from, and these
 * describe only the parts these rules actually use.
 */

/**
 * The element Turndown passes to a rule, with the flags it attaches while
 * walking the tree.
 */
export type TurndownNode = HTMLElement & {
	isBlock?: boolean;
	isCode?: boolean;
};

/** Decides whether a rule applies to a node. */
export type TurndownFilter = (node: TurndownNode) => boolean;

/** Turns a node and its already-converted children into markdown. */
export type TurndownReplacement = (content: string, node: TurndownNode) => string;

/** A rule as addRule takes it. */
export interface TurndownRule {
	filter: string | string[] | TurndownFilter;
	replacement: TurndownReplacement;
}
