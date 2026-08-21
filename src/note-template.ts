import {
	createEngine,
	standardFilters,
	TemplateRenderError,
	type TemplateFilter,
	type TemplateVariables,
} from '@obsidianmd/knap';
import { htmlFilters } from '@obsidianmd/knap/html';
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

const engine = createEngine<ImporterTemplateContext>({
	filters: {
		...standardFilters,
		...htmlFilters,
		markdown: markdownFilter,
	},
});

/** Render a Markdown note template using the shared Knap template language. */
export async function renderNoteTemplate(
	template: string,
	variables: NoteTemplateVariables,
): Promise<string> {
	const sourceUrl = typeof variables.url === 'string' ? variables.url : undefined;
	const result = await engine.render(template, {
		variables,
		context: { sourceUrl },
	});

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
