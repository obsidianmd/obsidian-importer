export interface RequestFailure {
	status?: number;
	code?: string;
	message?: string;
}

export interface RequestedService {
	name: string;
	subject: string;
	credential: string;
}

function property(error: object, key: string): unknown {
	return key in error ? (error as Record<string, unknown>)[key] : undefined;
}

function asStatus(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
	return undefined;
}

function asText(value: unknown): string | undefined {
	if (typeof value === 'string' && value !== '') return value;
	if (typeof value === 'number') return String(value);
	return undefined;
}

export function requestFailure(error: unknown): RequestFailure {
	if (typeof error !== 'object' || error === null) {
		return typeof error === 'string' && error !== '' ? { message: error } : {};
	}

	const failure: RequestFailure = {
		status: asStatus(property(error, 'status')),
		code: asText(property(error, 'code')),
		message: asText(property(error, 'message')),
	};

	// Graph nests the service error; prefer it to the generic wrapper.
	const nested = property(error, 'error');
	if (typeof nested === 'object' && nested !== null) {
		failure.status ??= asStatus(property(nested, 'status'));
		failure.code ??= asText(property(nested, 'code'));
		failure.message = asText(property(nested, 'message')) ?? failure.message;
	}

	return failure;
}

export function describeRequestFailure(error: unknown, service: RequestedService): string {
	const { name, subject, credential } = service;
	const { status, code, message } = requestFailure(error);

	if (status === 401) {
		return `${name} did not accept the request for ${subject}. ${credential}`;
	}
	if (status === 403) {
		return `${name} would not give access to ${subject}. ${credential}`;
	}
	if (status === 404) {
		return `${name} could not find ${subject}.`;
	}
	if (status === 429) {
		return `${name} is limiting how fast ${subject} can be read. Wait a few minutes and try again.`;
	}
	if (status === 408 || status === 504) {
		return `${name} took too long to return ${subject}. Try again shortly.`;
	}
	if (status !== undefined && status >= 500) {
		return `${name} could not return ${subject} right now. Try again shortly.`;
	}

	if (message) {
		return code
			? `Could not read ${subject}: ${message} (${code})`
			: `Could not read ${subject}: ${message}`;
	}
	if (code) {
		return `Could not read ${subject}. ${name} reported ${code}.`;
	}

	return `Could not read ${subject}.`;
}
