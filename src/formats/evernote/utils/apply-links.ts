import { parseFilePath } from '../../../filesystem';
import { EvernoteRun } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';

/** Resolve Evernote links by title; ENEX does not expose target IDs on notes. */
interface NoteLink {
	href: string;
	occurrence: RegExp;
	target: string | null;
	title: string;
	notebookName: string;
}

export const applyLinks = (run: EvernoteRun): number => {
	const entries = Object.entries(run.properties.getAllNoteIdNameMap());
	if (entries.length === 0) return 0;

	// Prevent a shorter address from replacing part of a longer one.
	entries.sort(([a], [b]) => b.length - a.length);

	const links: NoteLink[] = entries.map(([href, { title, notebookName }]) => ({
		href,
		occurrence: new RegExp(`\\[\\[${escapeStringRegexp(href)}\\]\\]|${escapeStringRegexp(href)}`, 'g'),
		target: run.plannedNote(title),
		title,
		notebookName,
	}));

	let unresolved = 0;

	for (const draft of run.drafts) {
		const from = parseFilePath(draft.path).parent;
		let updatedContent = draft.markdown;

		for (const link of links) {
			if (!updatedContent.includes(link.href)) continue;

			const to = linkTo(link, from);
			updatedContent = updatedContent.replace(link.occurrence, () => {
				if (!link.target) unresolved++;

				return to;
			});
		}

		draft.markdown = updatedContent;
	}

	return unresolved;
};

function linkTo({ href, target, title, notebookName }: NoteLink, from: string): string {
	if (!target && /^https?:/i.test(href)) return `[${title}](${href})`;

	const to = target
		? linkToNote(target, from)
		: notebookName && !from.endsWith(notebookName) ? `${notebookName}/${title}` : title;

	return to === title ? `[[${title}]]` : `[[${to}|${title}]]`;
}

function linkToNote(path: string, from: string): string {
	const { parent, basename } = parseFilePath(path);
	const name = basename.replace(/[[\]#^|]/g, '');

	return parent === from ? name : `${parseFilePath(parent).name}/${name}`;
}
