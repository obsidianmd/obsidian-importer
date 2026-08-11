import { parseFilePath } from '../../../filesystem';
import { EvernoteRun } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';

/** Resolve Evernote links by title; ENEX does not expose target IDs on notes. */
interface NoteLink {
	href: string;
	/** The link as the rule left it, and the bare address wherever else it appears. */
	occurrence: RegExp;
	target: string | null;
	title: string;
	notebookName: string;
}

export const applyLinks = (run: EvernoteRun): void => {
	const entries = Object.entries(run.properties.getAllNoteIdNameMap());
	if (entries.length === 0) return;

	// Longest first: one note's address can be another's with a trailing slash,
	// and replacing the shorter inside the longer would break the link it is part of.
	entries.sort(([a], [b]) => b.length - a.length);

	const links: NoteLink[] = entries.map(([href, { title, notebookName }]) => ({
		href,
		occurrence: new RegExp(`\\[\\[${escapeStringRegexp(href)}\\]\\]|${escapeStringRegexp(href)}`, 'g'),
		target: run.plannedNote(title),
		title,
		notebookName,
	}));

	for (const draft of run.drafts) {
		const from = parseFilePath(draft.path).parent;
		let updatedContent = draft.markdown;

		for (const link of links) {
			if (!updatedContent.includes(link.href)) continue;

			const to = linkTo(link, from);
			// One pass, so an address written back into the note is not read again.
			updatedContent = updatedContent.replace(link.occurrence, () => to);
		}

		draft.markdown = updatedContent;
	}
};

function linkTo({ href, target, title, notebookName }: NoteLink, from: string): string {
	// Nothing here answers to the title, but a web address still reaches the note.
	if (!target && /^https?:/i.test(href)) return `[${title}](${href})`;

	const to = target
		? linkToNote(target, from)
		: notebookName && !from.endsWith(notebookName) ? `${notebookName}/${title}` : title;

	// Preserve the display title when the target includes a folder.
	return to === title ? `[[${title}]]` : `[[${to}|${title}]]`;
}

function linkToNote(path: string, from: string): string {
	const { parent, basename } = parseFilePath(path);
	const name = basename.replace(/[[\]#^|]/g, '');

	return parent === from ? name : `${parseFilePath(parent).name}/${name}`;
}
