export type OneNoteErrorKind =
	| 'unsupported'
	| 'protected'
	| 'malformed'
	| 'limit';

export class OneNoteFormatError extends Error {
	readonly kind: OneNoteErrorKind;

	constructor(readonly code: string, message: string, readonly offset?: number) {
		super(offset === undefined ? message : `${message} (at 0x${offset.toString(16)})`);
		this.name = 'OneNoteFormatError';
		this.kind = kindOf(code);
	}
}

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
