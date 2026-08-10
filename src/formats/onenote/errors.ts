import { i18n } from '../../i18n';
import { describeRequestFailure, requestFailure } from '../../request-failure';

/** The OAuth token was not granted the scopes the notebooks need. */
export const SCOPE_REFUSED = '40004';
/** OneNote reports throttling with this code, sometimes without an HTTP 429. */
export const THROTTLED = '20166';

export function describeNotebookFailure(error: unknown): string {
	const failure = requestFailure(error);

	if (failure.code === SCOPE_REFUSED) {
		return i18n.importer.onenote.msgScopeRefused();
	}

	if (failure.code === THROTTLED) failure.status ??= 429;

	return describeRequestFailure(failure, {
		name: i18n.importer.onenote.labelService(),
		subject: i18n.importer.onenote.labelSubject(),
		credential: i18n.importer.onenote.labelCredential(),
	});
}
