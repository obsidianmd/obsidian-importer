import { describe, it, expect } from 'vitest';
import { parseFilePath, splitext } from '../../src/filesystem';

describe('parseFilePath', () => {
	it('parses a simple file path with forward slashes', () => {
		const result = parseFilePath('path/to/file.md');
		expect(result).toEqual({
			parent: 'path/to',
			name: 'file.md',
			basename: 'file',
			extension: 'md',
		});
	});

	it('parses a path with backslashes', () => {
		const result = parseFilePath('path\\to\\file.txt');
		expect(result).toEqual({
			parent: 'path\\to',
			name: 'file.txt',
			basename: 'file',
			extension: 'txt',
		});
	});

	it('handles a filename with no parent directory', () => {
		const result = parseFilePath('file.md');
		expect(result).toEqual({
			parent: '',
			name: 'file.md',
			basename: 'file',
			extension: 'md',
		});
	});

	it('handles a filename with multiple dots', () => {
		const result = parseFilePath('my.note.file.md');
		expect(result).toEqual({
			parent: '',
			name: 'my.note.file.md',
			basename: 'my.note.file',
			extension: 'md',
		});
	});

	it('handles a filename with no extension', () => {
		const result = parseFilePath('README');
		expect(result).toEqual({
			parent: '',
			name: 'README',
			basename: 'README',
			extension: '',
		});
	});

	it('lowercases the extension', () => {
		const result = parseFilePath('Photo.JPG');
		expect(result.extension).toBe('jpg');
	});

	it('handles a deeply nested path', () => {
		const result = parseFilePath('a/b/c/d/e/file.enex');
		expect(result.parent).toBe('a/b/c/d/e');
		expect(result.name).toBe('file.enex');
	});
});

describe('splitext', () => {
	it('splits a name with an extension', () => {
		expect(splitext('file.md')).toEqual(['file', 'md']);
	});

	it('splits a name with multiple dots', () => {
		expect(splitext('archive.tar.gz')).toEqual(['archive.tar', 'gz']);
	});

	it('returns the full name when there is no dot', () => {
		expect(splitext('Makefile')).toEqual(['Makefile', '']);
	});

	it('returns the full name when the dot is at position 0', () => {
		// dotIndex > 0 check means .hidden should NOT split
		expect(splitext('.hidden')).toEqual(['.hidden', '']);
	});

	it('lowercases the extension', () => {
		expect(splitext('Photo.JPG')).toEqual(['Photo', 'jpg']);
	});
});
