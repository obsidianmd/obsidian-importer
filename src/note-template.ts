import {
	createEngine,
	standardFilters,
	TemplateRenderError,
	type TemplateFilter,
	type TemplateResult,
	type TemplateVariables,
} from 'knap';
import { htmlFilters } from 'knap/html';
import { createMarkdownContent } from 'defuddle/full';

export type NoteTemplateVariables = TemplateVariables;

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

const engine = createEngine<ImporterTemplateContext>({
	filters: {
		...standardFilters,
		...htmlFilters,
		markdown: markdownFilter,
		fragment_link: fragmentLinkFilter,
	},
});

export async function renderNoteTemplateResult(
	template: string,
	variables: NoteTemplateVariables,
): Promise<TemplateResult> {
	const sourceUrl = typeof variables.url === 'string' ? variables.url : undefined;
	return await engine.render(template, {
		variables,
		context: { sourceUrl },
	});
}

export async function renderNoteTemplate(
	template: string,
	variables: NoteTemplateVariables,
): Promise<string> {
	const result = await renderNoteTemplateResult(template, variables);

	if (result.errors.length > 0) {
		throw new TemplateRenderError(result.errors);
	}
	if (result.warnings.length > 0) {
		console.warn(
			'Note template warnings:',
			result.warnings.map(warning =>
				`Line ${warning.line}, filter ${warning.filter}: ${warning.message}`
			).join('; '),
		);
	}

	return result.output;
}
