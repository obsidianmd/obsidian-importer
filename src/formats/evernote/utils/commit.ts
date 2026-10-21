import { parseFilePath } from '../../../filesystem';
import { ImportContext } from '../../../import-context';
import { EvernoteRun } from '../run';

/** Write and release attachments for drafts added since `from`. */
export const commitResources = async (run: EvernoteRun, from: number, ctx: ImportContext): Promise<void> => {
	for (const draft of run.drafts.slice(from)) {
		for (const resource of draft.resources) {
			let path = resource.fileName;
			try {
				const placed = await run.output.placeAttachment(resource.fileName, draft.path, resource.data.byteLength);
				path = placed.path;
				if (placed.write) await run.output.writeAttachment(placed.path, resource.data, resource.times);
			}
			catch (e) {
				ctx.reportFailed(resource.fileName, e);
			}

			draft.markdown = draft.markdown.split(resource.token).join(run.output.linkTo(path, draft.path));
		}

		draft.resources.length = 0;
	}
};

export const commitNotes = async (run: EvernoteRun, ctx: ImportContext): Promise<void> => {
	for (const draft of run.drafts) {
		try {
			await run.output.writeNote(draft.path, draft.markdown, draft.times);
		}
		catch (e) {
			ctx.reportFailed(parseFilePath(draft.path).basename, e);
		}
	}
};
