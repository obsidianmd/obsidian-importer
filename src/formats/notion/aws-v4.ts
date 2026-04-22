/**
 * AWS Signature Version 4 — minimal S3 PUT signing.
 * Uses Web Crypto API (available in Obsidian/Electron). No external deps.
 */

function hexEncode(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256(data: string | ArrayBuffer): Promise<ArrayBuffer> {
	const encoded =
		typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
	return crypto.subtle.digest('SHA-256', encoded);
}

async function hmac(keyBuf: ArrayBuffer, message: string): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey(
		'raw',
		keyBuf,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

function amzDate(d: Date): string {
	return d.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
}

function dateStamp(d: Date): string {
	return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export interface S3PutOptions {
	bucket: string;
	region: string;
	/** S3 object key, e.g. "attachments/image.png" */
	key: string;
	body: ArrayBuffer;
	contentType: string;
	accessKey: string;
	secretKey: string;
}

/**
 * Compute AWS V4 signed headers for an S3 PUT request.
 * Returns a headers object ready for Obsidian's requestUrl().
 */
export async function buildS3PutHeaders(
	opts: S3PutOptions,
): Promise<Record<string, string>> {
	const { bucket, region, key, body, contentType, accessKey, secretKey } = opts;

	const now = new Date();
	const xAmzDate = amzDate(now);
	const stamp = dateStamp(now);
	const host = `${bucket}.s3.${region}.amazonaws.com`;
	const payloadHash = hexEncode(await sha256(body));

	const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
	const canonicalHeaders =
		`content-type:${contentType}\n` +
		`host:${host}\n` +
		`x-amz-content-sha256:${payloadHash}\n` +
		`x-amz-date:${xAmzDate}\n`;

	const encodedKey = key
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');

	const canonicalRequest = [
		'PUT',
		`/${encodedKey}`,
		'',
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join('\n');

	const credentialScope = `${stamp}/${region}/s3/aws4_request`;
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		xAmzDate,
		credentialScope,
		hexEncode(await sha256(canonicalRequest)),
	].join('\n');

	const kDate = await hmac(new TextEncoder().encode(`AWS4${secretKey}`).buffer as ArrayBuffer, stamp);
	const kRegion = await hmac(kDate, region);
	const kService = await hmac(kRegion, 's3');
	const kSigning = await hmac(kService, 'aws4_request');
	const signature = hexEncode(await hmac(kSigning, stringToSign));

	const authorization =
		`AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
		`SignedHeaders=${signedHeaders}, ` +
		`Signature=${signature}`;

	return {
		Authorization: authorization,
		'Content-Type': contentType,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': xAmzDate,
	};
}

/** Public S3 URL for an object. */
export function s3Url(bucket: string, region: string, key: string): string {
	return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
