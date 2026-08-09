import { describeRequestFailure, requestFailure } from '../../request-failure';

const ONENOTE = {
	name: 'OneNote',
	subject: 'your notebooks',
	credential: 'Sign out and back in to try again.',
};

export function describeNotebookFailure(error: unknown): string {
	const failure = requestFailure(error);

	if (failure.code === '40004') {
		return 'OneNote did not grant this sign-in access to your notebooks. This usually means a work or school account whose notebooks need an administrator to allow access; a personal Microsoft account does not.';
	}

	// OneNote may report throttling without an HTTP 429 status.
	if (failure.code === '20166') failure.status ??= 429;

	return describeRequestFailure(failure, ONENOTE);
}
