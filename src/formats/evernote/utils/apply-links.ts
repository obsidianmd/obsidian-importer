import { EvernoteRun, NoteDraft } from '../run';
import { escapeStringRegexp } from './escape-string-regexp';
import { normalizeTitle } from './filename-utils';

/**
 * Turn every evernote:// link into the note it points at.
 *
 * A note can link to one in a notebook that has not been read yet, so this
 * runs once the whole import has been converted - over the drafts, which is
 * every note the import is writing and nothing else.
 *
 * An ENEX gives no id a link could be resolved by: the href carries the note's
 * Evernote guid, and no note in the export says what its own guid is. What
 * there is to go on is the text of the link, which Evernote writes as the
 * title of the note it points at. So a link is matched to a note by title, and
 * the note's own path - the one planNote settled, which may be numbered past a
 * name already taken or cut to fit its folder - is what the link is written
 * to. A title no note in the import has, or one that two of them share, is
 * left as the text it was, because nothing here can tell which was meant.
 */
export const applyLinks = (run: EvernoteRun): void => {
	const entries = Object.entries(run.properties.getAllNoteIdNameMap());
	if (entries.length === 0) return;

	const byTitle = notesByTitle(run.drafts);

	for (const draft of run.drafts) {
		const from = folderOf(draft.path);
		let updatedContent = draft.markdown;

		for (const [linkName, linkProps] of entries) {
			const { title, notebookName } = linkProps;
			const target = byTitle.get(title);

			const to = target
				? linkToNote(target.path, from)
				: notebookName && !from.endsWith(notebookName) ? `${notebookName}/${title}` : title;

			// A link that has to name a folder says what to call it as well, or
			// the standardizing pass takes the whole path for the display text
			// and the note reads "Notebook/Note" where it meant "Note".
			const replacement = to === title ? title : `${to}|${title}`;

			updatedContent = updatedContent.replace(new RegExp(escapeStringRegexp(linkName), 'g'), replacement);
		}

		draft.markdown = updatedContent;
	}
};

/** The one note of each title, leaving out any title more than one note has. */
function notesByTitle(drafts: NoteDraft[]): Map<string, NoteDraft> {
	const found = new Map<string, NoteDraft | null>();

	for (const draft of drafts) {
		const title = normalizeTitle(draft.note.title ?? '');
		found.set(title, found.has(title) ? null : draft);
	}

	return new Map([...found].filter((entry): entry is [string, NoteDraft] => entry[1] !== null));
}

/**
 * The note's own name, with its folder in front when that is a different one.
 *
 * The brackets, hash and caret a file name may carry are taken back out: they
 * are what a wikilink is made of, so a target holding one cannot be addressed
 * by a plain link whether or not the file is named that. normalizeTitle drops
 * the same ones on the way in, so a title carrying them links as it always has.
 */
function linkToNote(path: string, from: string): string {
	const folder = folderOf(path);
	const name = path.slice(folder.length + 1).replace(/\.md$/i, '').replace(/[[\]#^|]/g, '');

	return folder === from ? name : `${folder.slice(folder.lastIndexOf('/') + 1)}/${name}`;
}

function folderOf(path: string): string {
	return path.slice(0, path.lastIndexOf('/'));
}
