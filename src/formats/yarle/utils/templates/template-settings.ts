/**
 * Called with no arguments; the result is only tested for truthiness, so it may
 * be a boolean or the value whose presence is being checked.
 */
export type TemplateBlockCheck = () => unknown;

/**
 * The tokens one placeholder module exports to delimit its block.
 *
 * Each block in a template is written as START_BLOCK ... END_BLOCK, and the
 * modules under placeholders/ each name one block's tokens.
 */
export interface TemplateBlockPlaceholders {
	START_BLOCK: string;
	END_BLOCK: string;
}

/**
 * A block that also substitutes a value in place of a token.
 *
 * The metadata block is the one that does not: it wraps a fixed set of fields
 * rather than a single value, so it has no CONTENT_PLACEHOLDER.
 */
export interface TemplateValuePlaceholders extends TemplateBlockPlaceholders {
	CONTENT_PLACEHOLDER: string;
}

export interface TemplateBlockSettings {
	template: string;
	check: TemplateBlockCheck;
	startBlockPlaceholder: string;
	endBlockPlaceholder: string;
	valuePlaceholder: string;
	value?: string;
}
