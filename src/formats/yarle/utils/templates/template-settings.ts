/**
 * Called with no arguments; the result is only tested for truthiness, so it may
 * be a boolean or the value whose presence is being checked.
 */
export type TemplateBlockCheck = () => unknown;

export interface TemplateBlockSettings {
	template: string;
	check: TemplateBlockCheck;
	startBlockPlaceholder: string;
	endBlockPlaceholder: string;
	valuePlaceholder: string;
	value?: string;
}
