import {
	createEngine,
	standardFilters,
	type TemplateFilter,
} from 'knap';
import { htmlFilters } from 'knap/html';
import { createMarkdownContent } from 'defuddle/full';

interface ImporterTemplateContext {
	sourceUrl?: string;
}

function scalarFilterParam(param?: string): string | undefined {
	if (!param) return undefined;
	const match = /^(['"])([\s\S]*)\1$/u.exec(param.trim());
	return (match?.[2] ?? param).replace(/\\([\\"'])/gu, '$1');
}

const markdownFilter: TemplateFilter<ImporterTemplateContext> = (value, param, filterContext) =>
	createMarkdownContent(
		value,
		scalarFilterParam(param) ?? filterContext?.context?.sourceUrl ?? 'about:blank',
	);
markdownFilter.metadata = {};

const fragmentLinkFilter: TemplateFilter<ImporterTemplateContext> = (value, param, filterContext) => {
	const combinedParam = [param, filterContext?.context?.sourceUrl].filter(Boolean).join(':');
	return standardFilters.fragment_link(value, combinedParam, filterContext);
};
fragmentLinkFilter.metadata = {};

export const engine = createEngine<ImporterTemplateContext>({
	filters: {
		...standardFilters,
		...htmlFilters,
		markdown: markdownFilter,
		fragment_link: fragmentLinkFilter,
	},
});

export { TemplateRenderError } from 'knap';
