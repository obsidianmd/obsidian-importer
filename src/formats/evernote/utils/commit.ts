import { moment } from 'obsidian';

import { formatMarkdown } from '../../../markdown-output';
import { EvernoteRun } from '../run';

/**
 * Put everything the import converted where it decided it goes.
 *
 * The attachments are placed here rather than as they are decoded, because
 * where one goes is the output's business and depends on the note it belongs
 * to. Until then the markdown carries a token, which is what is swapped for
 * the link once the file has a path.
 */
export const commit = async (run: EvernoteRun): Promise<void> => {
	for (const draft of run.drafts) {
		const links: [token: string, link: string][] = [];

		for (const resource of draft.resources) {
			const placed = await run.output.placeAttachment(resource.fileName, draft.path, resource.data.byteLength);
			if (placed.write) await run.output.write(placed.path, resource.data, resource.times);

			links.push([resource.token, run.output.linkTo(placed.path, draft.path)]);
		}

		let markdown = draft.markdown;
		// Longest first: ENEX-ATTACHMENT-1- is a prefix of nothing, but a token
		// substituted early must not leave a shorter one matching inside a link.
		for (const [token, link] of links.sort(([a], [b]) => b.length - a.length)) {
			markdown = markdown.split(token).join(link);
		}

		await run.output.write(draft.path, formatMarkdown(markdown, run.markdownOutput), {
			ctime: moment(draft.note.created).valueOf() || undefined,
			mtime: moment(draft.note.updated).valueOf() || undefined,
		});
	}
};
