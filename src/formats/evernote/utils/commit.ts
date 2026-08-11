import { EvernoteRun } from '../run';

/**
 * Write the attachments of every note drafted since `from`, and put their
 * links into the markdown where the tokens are.
 *
 * Called as each enex finishes rather than at the end of the import, so an
 * export's attachments are not all held decoded at once - the bytes of a
 * notebook are let go as soon as they are on disk. Where an attachment goes
 * depends only on the note it belongs to, and that was settled when the note
 * was planned, so writing them early settles nothing early.
 */
export const commitResources = async (run: EvernoteRun, from: number): Promise<void> => {
	for (const draft of run.drafts.slice(from)) {
		for (const resource of draft.resources) {
			const placed = await run.output.placeAttachment(resource.fileName, draft.path, resource.data.byteLength);
			if (placed.write) await run.output.writeAttachment(placed.path, resource.data, resource.times);

			// A token ends in the '-' its number is followed by, so no token is
			// part of another and the order they are put back in does not matter.
			draft.markdown = draft.markdown.split(resource.token).join(run.output.linkTo(placed.path, draft.path));
		}

		draft.resources.length = 0;
	}
};

/**
 * Write every note the import converted.
 *
 * Last, because a note can link to one in a notebook that had not been read
 * when it was converted, and applyLinks only knows where they all landed once
 * every enex has been.
 */
export const commitNotes = async (run: EvernoteRun): Promise<void> => {
	for (const draft of run.drafts) {
		await run.output.writeNote(draft.path, draft.markdown, draft.times);
	}
};
