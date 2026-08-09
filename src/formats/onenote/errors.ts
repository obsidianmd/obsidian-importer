import { describeRequestFailure, requestFailure } from '../../request-failure';

const ONENOTE = {
	name: 'OneNote',
	subject: 'your notebooks',
	credential: 'Sign out and back in to try again.',
};

export function describeNotebookFailure(error: unknown): string {
	const failure = requestFailure(error);

	if (failure.code === '40004') {
		return 'OneNote did not grant this sign-in access to your notebooks. Sign out and sign in again to ask for work or school access, which your organization may need to approve.';
	}

	// OneNote may report throttling without an HTTP 429 status.
	if (failure.code === '20166') failure.status ??= 429;

	return describeRequestFailure(failure, ONENOTE);
}
