const IMAGE_MIME: Record<string, string> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	webp: 'image/webp',
};

// Keep preview memory bounded without changing imported attachments.
export const MAX_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PREVIEW_IMAGES_BYTES = 10 * 1024 * 1024;
export const PREVIEW_IMAGE_PLACEHOLDER =
	'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export function previewImageMime(extension: string): string | undefined {
	return IMAGE_MIME[extension.toLowerCase()];
}

/** Images shared by the samples and rerenders of one template preview screen. */
export class PreviewImageStore {
	private readonly resolved = new Map<string, Promise<string>>();
	private readonly urls = new Set<string>();
	private remainingBytes = MAX_PREVIEW_IMAGES_BYTES;
	private disposed = false;

	get(key: string, mime: string, read: () => Promise<ArrayBuffer>, size?: number): Promise<string> {
		if (this.disposed) return Promise.resolve(PREVIEW_IMAGE_PLACEHOLDER);
		const existing = this.resolved.get(key);
		if (existing) return existing;

		const loading = this.load(mime, read, size);
		this.resolved.set(key, loading);
		return loading;
	}

	private async load(mime: string, read: () => Promise<ArrayBuffer>, size?: number): Promise<string> {
		if (size !== undefined && (size > MAX_PREVIEW_IMAGE_BYTES || size > this.remainingBytes)) {
			return PREVIEW_IMAGE_PLACEHOLDER;
		}
		try {
			const data = await read();
			// A read may finish after Back or Close. Never allocate a URL then.
			if (this.disposed || data.byteLength > MAX_PREVIEW_IMAGE_BYTES || data.byteLength > this.remainingBytes) {
				return PREVIEW_IMAGE_PLACEHOLDER;
			}
			const url = URL.createObjectURL(new Blob([data], { type: mime }));
			this.remainingBytes -= data.byteLength;
			this.urls.add(url);
			return url;
		}
		catch {
			return PREVIEW_IMAGE_PLACEHOLDER;
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls.clear();
		this.resolved.clear();
	}
}
