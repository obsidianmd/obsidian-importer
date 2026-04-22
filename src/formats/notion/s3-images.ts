/**
 * S3 image upload & embed conversion for Notion imports.
 *
 * After the main HTML→MD import, scans imported files for local image
 * wiki-embeds and uploads them to S3:
 *   ![[image.png]]        → ![image](https://s3-url/image.png)
 *   ![[image.png|120]]    → <img src="https://s3-url/image.png" width="120" />
 */

import { requestUrl, Vault } from 'obsidian';
import { ImportContext } from '../../main';
import { buildS3PutHeaders, s3Url } from './aws-v4';

const IMAGE_EXTS_RE = /\.(png|jpg|jpeg|gif|webp|heic|svg|bmp)$/i;

/** Matches ![[filename.ext]] and ![[filename.ext|width]] */
const EMBED_RE =
	/!\[\[([^\]|]+\.(?:png|jpg|jpeg|gif|webp|heic|svg|bmp))(?:\|(\d+))?\]\]/gi;

const CONTENT_TYPE: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
};

export interface S3Config {
	bucket: string;
	region: string;
	keyPrefix: string;
	accessKey: string;
	secretKey: string;
}

/** Per-run cache: filename → final S3 URL */
const uploadCache = new Map<string, string>();

async function uploadToS3(
	vault: Vault,
	localPath: string,
	filename: string,
	config: S3Config,
): Promise<string | null> {
	if (uploadCache.has(filename)) return uploadCache.get(filename)!;

	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	const contentType = CONTENT_TYPE[ext] ?? 'application/octet-stream';

	let body: ArrayBuffer;
	try {
		body = await vault.adapter.readBinary(localPath);
	}
	catch {
		return null;
	}

	const s3Key = `${config.keyPrefix}${filename}`;
	const url = s3Url(config.bucket, config.region, s3Key);

	// HEAD check — skip upload if already on S3
	try {
		const head = await requestUrl({ url, method: 'HEAD', throw: false });
		if (head.status === 200) {
			uploadCache.set(filename, url);
			return url;
		}
	}
	catch {
		// Ignore — fall through to PUT
	}

	// PUT with V4 signed headers
	try {
		const headers = await buildS3PutHeaders({
			bucket: config.bucket,
			region: config.region,
			key: s3Key,
			body,
			contentType,
			accessKey: config.accessKey,
			secretKey: config.secretKey,
		});

		const resp = await requestUrl({ url, method: 'PUT', body, headers });
		if (resp.status === 200 || resp.status === 204) {
			uploadCache.set(filename, url);
			return url;
		}
		return null;
	}
	catch {
		return null;
	}
}

/**
 * Post-import step: scan all MD files under targetFolder for wiki-image
 * embeds, upload to S3, and rewrite links.
 */
export async function uploadImagesToS3(
	vault: Vault,
	ctx: ImportContext,
	targetFolderPath: string,
	attachmentFolderPath: string,
	config: S3Config,
): Promise<{ uploaded: number; failed: number }> {
	uploadCache.clear();

	if (!config.accessKey || !config.secretKey || !config.bucket || !config.region) {
		return { uploaded: 0, failed: 0 };
	}

	let uploaded = 0;
	let failed = 0;

	const mdFiles = vault.getFiles().filter(
		(f) => f.extension === 'md' && f.path.startsWith(targetFolderPath)
	);

	const total = mdFiles.length;
	let current = 0;

	for (const md of mdFiles) {
		if (ctx.isCancelled()) break;

		current++;
		ctx.status(`Uploading images to S3 (${current}/${total}): ${md.name}`);
		ctx.reportProgress(current, total);

		let text: string;
		try {
			text = await vault.cachedRead(md);
		}
		catch {
			continue;
		}

		if (!EMBED_RE.test(text)) continue;
		EMBED_RE.lastIndex = 0;

		type Match = { full: string; filename: string; width?: string };
		const matches: Match[] = [];
		let m: RegExpExecArray | null;
		while ((m = EMBED_RE.exec(text)) !== null) {
			matches.push({ full: m[0], filename: m[1], width: m[2] });
		}
		if (matches.length === 0) continue;

		let newText = text;
		let modified = false;

		for (const { full, filename, width } of matches) {
			// Try common attachment paths
			const localPath = attachmentFolderPath
				? `${attachmentFolderPath}/${filename}`
				: filename;

			const finalUrl = await uploadToS3(vault, localPath, filename, config);
			if (!finalUrl) {
				failed++;
				continue;
			}
			uploaded++;

			const altText = filename.replace(/\.[^.]+$/, '');
			const replacement = width
				? `<img src="${finalUrl}" width="${width}" />`
				: `![${altText}](${finalUrl})`;

			newText = newText.replace(full, replacement);
			modified = true;
		}

		if (modified) {
			await vault.modify(md, newText);
		}
	}

	return { uploaded, failed };
}
