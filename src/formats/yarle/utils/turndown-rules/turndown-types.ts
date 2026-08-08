
export type TurndownNode = HTMLElement & {
	isBlock?: boolean;
	isCode?: boolean;
};

export type TurndownFilter = (node: TurndownNode) => boolean;

export type TurndownReplacement = (content: string, node: TurndownNode) => string;

export interface TurndownRule {
	filter: string | string[] | TurndownFilter;
	replacement: TurndownReplacement;
}
