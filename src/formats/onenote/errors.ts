import { describeRequestFailure, requestFailure } from '../../request-failure';

/** The OAuth token was not granted the scopes the notebooks need. */
export const SCOPE_REFUSED = '40004';
/** OneNote reports throttling with this code, sometimes without an HTTP 429. */
export const THROTTLED = '20166';

const ONENOTE = {
	name: 'OneNote',
	subject: 'your notebooks',
	credential: 'Sign out and back in to try again.',
};

export function describeNotebookFailure(error: unknown): string {
	const failure = requestFailure(error);

	if (failure.code === SCOPE_REFUSED) {
		return 'OneNote did not grant this sign-in access to your notebooks. Sign out and sign in again to ask for work or school access, which your organization may need to approve.';
	}

	if (failure.code === THROTTLED) failure.status ??= 429;

	return describeRequestFailure(failure, ONENOTE);
}
