/**
 * A container or revision store that could not be read.
 *
 * The code is what the importer maps to a translated reason for
 * `reportFailed`; the message is a diagnostic and stays in English, so it can
 * be pasted into an issue and mean the same thing to whoever reads it.
 */
export class OneNoteFormatError extends Error {
	constructor(readonly code: string, message: string, readonly offset?: number) {
		super(offset === undefined ? message : `${message} (at 0x${offset.toString(16)})`);
		this.name = 'OneNoteFormatError';
	}
}
