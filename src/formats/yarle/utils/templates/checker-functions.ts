import { TemplateValuePlaceholders } from './template-settings';
import * as CREATIONTIME from './placeholders/createdat-placeholders';
import * as LOCATION from './placeholders/location-placeholders';
import * as NOTEBOOK from './placeholders/notebook-placeholders';
import * as SOURCEURL from './placeholders/sourceurl-placeholders';
import * as YAMLLISTTAGS from './placeholders/tags-yaml-list-placeholders';
import * as TAGS from './placeholders/tags-placeholders';
import * as UPDATETIME from './placeholders/updatedat-placeholders';

export const hasCreationTimeInTemplate = (templateContent: string): boolean => {
	return hasItemInTemplate(CREATIONTIME, templateContent);
};

export const hasLocationInTemplate = (templateContent: string): boolean => {
	return hasItemInTemplate(LOCATION, templateContent);
};
export const hasNotebookInTemplate = (templateContent: string): boolean => {
	return hasItemInTemplate(NOTEBOOK, templateContent);
};
export const hasSourceURLInTemplate = (templateContent: string): boolean => {
	return hasItemInTemplate(SOURCEURL, templateContent);
};
export const hasAnyTagsInTemplate = (templateContent: string): boolean => {
	return (hasItemInTemplate(TAGS, templateContent)
		|| hasItemInTemplate(YAMLLISTTAGS, templateContent));
};

export const hasUpdateTimeInTemplate = (templateContent: string): boolean => {
	return hasItemInTemplate(UPDATETIME, templateContent);
};
const hasItemInTemplate = (item: TemplateValuePlaceholders, templateContent: string): boolean => {
	return templateContent.includes(item.START_BLOCK) &&
		templateContent.includes(item.CONTENT_PLACEHOLDER) &&
		templateContent.includes(item.END_BLOCK);
};
