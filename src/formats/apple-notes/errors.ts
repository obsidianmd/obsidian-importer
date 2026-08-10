import { i18n } from '../../i18n';
import { extractErrorMessage } from '../../util';

export function noAccessHint(): string {
	return i18n.importer.appleNotes.msgNoAccess();
}

export function describeFolderFailure(error: unknown): string {
	// SQLite errors arrive either prefixed or as bare stderr.
	const detail = (extractErrorMessage(error) ?? '').replace(/^SQLITE_ERROR:\s*/, '').trim();

	if (/\block|locked|busy\b/i.test(detail)) {
		return i18n.importer.appleNotes.msgDatabaseBusy();
	}
	if (/unable to open|no such file|not authorized/i.test(detail)) {
		return i18n.importer.appleNotes.msgDatabaseUnreadable({ hint: noAccessHint() });
	}

	return detail
		? i18n.importer.appleNotes.msgReadFailedWithDetail({ detail })
		: i18n.importer.appleNotes.msgReadFailed();
}
