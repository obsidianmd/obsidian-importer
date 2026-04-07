import { describe, it, expect } from 'vitest';
import { sanitizeFileName, parseHTML, serializeFrontMatter, truncateText } from './util';

describe('sanitizeFileName', () => {
	it('strips illegal characters', () => {
		expect(sanitizeFileName('my:file*name?.md')).toBe('myfilename.md');
	});

	it('replaces slashes with dashes', () => {
		expect(sanitizeFileName('path/to\\file')).toBe('path-to-file');
	});

	it('strips characters that interfere with links', () => {
		expect(sanitizeFileName('file[1]#heading')).toBe('file1heading');
	});

	it('removes leading dots', () => {
		expect(sanitizeFileName('.hidden')).toBe('hidden');
	});

	it('returns "Untitled" for completely empty names', () => {
		expect(sanitizeFileName('***')).toBe('Untitled');
	});

	it('handles Windows reserved names by falling back to Untitled', () => {
		expect(sanitizeFileName('CON')).toBe('Untitled');
	});

	it('strips trailing dots and spaces', () => {
		expect(sanitizeFileName('file. . ')).toBe('file');
	});
});

describe('parseHTML', () => {
	it('returns an HTMLElement from valid HTML', () => {
		const el = parseHTML('<html><body><p>Hello</p></body></html>');
		expect(el).toBeDefined();
		expect(el.querySelector('p')?.textContent).toBe('Hello');
	});

	it('handles partial HTML fragments', () => {
		const el = parseHTML('<div class="test">content</div>');
		expect(el.querySelector('.test')?.textContent).toBe('content');
	});
});

describe('serializeFrontMatter', () => {
	it('wraps object in YAML delimiters', () => {
		const result = serializeFrontMatter({ title: 'Test' });
		expect(result).toMatch(/^---\n/);
		expect(result).toMatch(/---\n$/);
		expect(result).toContain('title: Test');
	});

	it('returns empty string for empty object', () => {
		expect(serializeFrontMatter({})).toBe('');
	});

	it('serialises array values', () => {
		const result = serializeFrontMatter({ tags: ['a', 'b'] });
		expect(result).toContain('- a');
		expect(result).toContain('- b');
	});
});

describe('truncateText', () => {
	it('returns original text when under limit', () => {
		expect(truncateText('short', 10)).toBe('short');
	});

	it('truncates and appends ellipses when over limit', () => {
		expect(truncateText('a long string', 6)).toBe('a long...');
	});

	it('uses custom ellipses', () => {
		expect(truncateText('abcdef', 3, '~')).toBe('abc~');
	});
});
