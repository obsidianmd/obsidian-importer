import { describe, it, expect } from 'vitest';
import { extensionForMime } from '../../src/mime';

describe('extensionForMime', () => {
	it('returns the correct extension for common MIME types', () => {
		expect(extensionForMime('image/png')).toBe('png');
		expect(extensionForMime('image/jpeg')).toBe('jpeg');
		expect(extensionForMime('image/gif')).toBe('gif');
		expect(extensionForMime('image/webp')).toBe('webp');
		expect(extensionForMime('image/svg+xml')).toBe('svg');
	});

	it('returns the correct extension for document types', () => {
		expect(extensionForMime('application/pdf')).toBe('pdf');
		expect(extensionForMime('application/json')).toBe('json');
		expect(extensionForMime('application/zip')).toBe('zip');
		expect(extensionForMime('text/html')).toBe('html');
		expect(extensionForMime('text/css')).toBe('css');
		expect(extensionForMime('text/plain')).toBe('txt');
		expect(extensionForMime('text/csv')).toBe('csv');
		expect(extensionForMime('text/markdown')).toBe('markdown');
	});

	it('returns the correct extension for audio/video types', () => {
		expect(extensionForMime('audio/mpeg')).toBe('mpga');
		expect(extensionForMime('audio/mp3')).toBe('mp3');
		expect(extensionForMime('audio/wav')).toBe('wav');
		expect(extensionForMime('video/mp4')).toBe('mp4');
		expect(extensionForMime('video/webm')).toBe('webm');
	});

	it('returns the correct extension for Office document types', () => {
		expect(extensionForMime('application/msword')).toBe('doc');
		expect(extensionForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
		expect(extensionForMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
		expect(extensionForMime('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx');
	});

	it('handles MIME types with parameters (e.g., charset)', () => {
		expect(extensionForMime('text/html; charset=utf-8')).toBe('html');
		expect(extensionForMime('application/json; charset=utf-8')).toBe('json');
	});

	it('handles case-insensitive MIME types', () => {
		expect(extensionForMime('IMAGE/PNG')).toBe('png');
		expect(extensionForMime('Text/HTML')).toBe('html');
		expect(extensionForMime('Application/PDF')).toBe('pdf');
	});

	it('returns empty string for unknown MIME types', () => {
		expect(extensionForMime('application/x-unknown-type-12345')).toBe('');
		expect(extensionForMime('foo/bar')).toBe('');
	});

	it('returns empty string for empty or invalid input', () => {
		expect(extensionForMime('')).toBe('');
		expect(extensionForMime(null as any)).toBe('');
		expect(extensionForMime(undefined as any)).toBe('');
		expect(extensionForMime(42 as any)).toBe('');
	});

	it('handles leading whitespace in the MIME type', () => {
		expect(extensionForMime('  image/png')).toBe('png');
	});

	it('returns the correct extension for font types', () => {
		expect(extensionForMime('font/woff2')).toBe('woff2');
		expect(extensionForMime('font/ttf')).toBe('ttf');
		expect(extensionForMime('font/otf')).toBe('otf');
	});
});
