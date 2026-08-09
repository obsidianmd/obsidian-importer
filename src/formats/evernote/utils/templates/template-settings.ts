export type TemplateBlockCheck = () => unknown;

export interface TemplateBlockPlaceholders {
	START_BLOCK: string;
	END_BLOCK: string;
}

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
