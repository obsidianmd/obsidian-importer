import { extractErrorMessage } from '../../util';

export const NO_ACCESS_HINT = 'Allow access to your notes to see the folders in them.';

export function describeFolderFailure(error: unknown): string {
	// SQLite errors arrive either prefixed or as bare stderr.
	const detail = (extractErrorMessage(error) ?? '').replace(/^SQLITE_ERROR:\s*/, '').trim();

	if (/\block|locked|busy\b/i.test(detail)) {
		return 'Your Apple Notes database is in use. Quit Notes and try again.';
	}
	if (/unable to open|no such file|not authorized/i.test(detail)) {
		return `Could not open your Apple Notes database. ${NO_ACCESS_HINT}`;
	}

	return detail ? `Could not read your notes: ${detail}` : 'Could not read your notes.';
}
