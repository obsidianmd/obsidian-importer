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

export const MAX_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PREVIEW_IMAGES_BYTES = 10 * 1024 * 1024;
export const PREVIEW_IMAGE_PLACEHOLDER =
	'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export function previewImageMime(extension: string): string | undefined {
	return IMAGE_MIME[extension.toLowerCase()];
}

export function previewImageDataUrl(mime: string, buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return `data:${mime};base64,${btoa(binary)}`;
}
