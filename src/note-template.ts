import type { TemplateResult, TemplateVariables } from 'knap';

export type NoteTemplateVariables = TemplateVariables;

// The engine loads with the first template: Knap and Defuddle's Markdown converter are slow to set up.
export async function renderNoteTemplateResult(
	template: string,
	variables: NoteTemplateVariables,
): Promise<TemplateResult> {
	const sourceUrl = typeof variables.url === 'string' ? variables.url : undefined;
	const { engine } = await import('./note-template-engine');
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
		const { TemplateRenderError } = await import('./note-template-engine');
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
