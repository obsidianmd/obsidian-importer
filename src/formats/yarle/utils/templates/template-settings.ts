export type CheckFunction = () => unknown;

export interface TemplateBlockSettings {
	template: string;
	check: CheckFunction;
	startBlockPlaceholder: string;
	endBlockPlaceholder: string;
	valuePlaceholder: string;
	value?: string;
}
