import { EvernoteRun } from '../run';

/** Write and release attachments for drafts added since `from`. */
export const commitResources = async (run: EvernoteRun, from: number): Promise<void> => {
	for (const draft of run.drafts.slice(from)) {
		for (const resource of draft.resources) {
			const placed = await run.output.placeAttachment(resource.fileName, draft.path, resource.data.byteLength);
			if (placed.write) await run.output.writeAttachment(placed.path, resource.data, resource.times);

			draft.markdown = draft.markdown.split(resource.token).join(run.output.linkTo(placed.path, draft.path));
		}

		draft.resources.length = 0;
	}
};

export const commitNotes = async (run: EvernoteRun): Promise<void> => {
	for (const draft of run.drafts) {
		await run.output.writeNote(draft.path, draft.markdown, draft.times);
	}
};
