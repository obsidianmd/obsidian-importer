/**
 * A container or revision store that could not be read.
 *
 * `kind` is a closed set so the importer can say something useful about each
 * one and cannot forget a new member; `code` stays free-form because it is the
 * diagnostic that goes in an issue, and it reads the same whoever ran the
 * import.
 */
export type OneNoteErrorKind =
	/** A real OneNote file this importer cannot read yet. */
	| 'unsupported'
	/** Readable only by someone the rights-management policy allows. */
	| 'protected'
	/** The bytes do not describe what they claim to. */
	| 'malformed'
	/** Well-formed, but larger than the configured ceilings. */
	| 'limit';

export class OneNoteFormatError extends Error {
	readonly kind: OneNoteErrorKind;

	constructor(readonly code: string, message: string, readonly offset?: number) {
		super(offset === undefined ? message : `${message} (at 0x${offset.toString(16)})`);
		this.name = 'OneNoteFormatError';
		this.kind = kindOf(code);
	}
}

/**
 * The code names the failure precisely; this sorts those names into the four
 * answers a user can actually act on.
 */
function kindOf(code: string): OneNoteErrorKind {
	if (code.endsWith('_LIMIT') || code === 'ONENOTE_OFFSET_RANGE') return 'limit';
	if (code === 'ONENOTE_ONEX_PROTECTED') return 'protected';

	const unsupported = [
		'ONENOTE_CAB_MSZIP',
		'ONENOTE_CAB_COMPRESSION',
		'ONENOTE_CAB_LZX_WINDOW',
		'ONENOTE_NOT_REVISION_STORE',
		'ONENOTE_UNKNOWN_FILE_FORMAT',
		'ONENOTE_ONEX_UNSUPPORTED',
		'ONENOTE_PROPERTY_TYPE',
	];

	return unsupported.includes(code) ? 'unsupported' : 'malformed';
}
