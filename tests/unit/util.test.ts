import { describe, it, expect } from 'vitest';
import {
	sanitizeFileName,
	genUid,
	truncateText,
	extractErrorMessage,
	serializeFrontMatter,
	uint8arrayToArrayBuffer,
	stringToUtf8,
} from '../../src/util';

describe('sanitizeFileName', () => {
	it('returns the name unchanged when it is already safe', () => {
		expect(sanitizeFileName('my-note')).toBe('my-note');
	});

	it('replaces forward slashes with dashes', () => {
		expect(sanitizeFileName('path/to/note')).toBe('path-to-note');
	});

	it('replaces backslashes with dashes', () => {
		expect(sanitizeFileName('path\\to\\note')).toBe('path-to-note');
	});

	it('strips illegal characters (? < > : * | ")', () => {
		expect(sanitizeFileName('note?<>:*|"name')).toBe('notename');
	});

	it('strips control characters', () => {
		expect(sanitizeFileName('note\x00\x1fname')).toBe('notename');
	});

	it('strips reserved dot-only names', () => {
		expect(sanitizeFileName('...')).toBe('Untitled');
	});

	it('strips Windows reserved names (result falls through to Untitled)', () => {
		expect(sanitizeFileName('CON')).toBe('Untitled');
		expect(sanitizeFileName('PRN')).toBe('Untitled');
		expect(sanitizeFileName('nul.txt')).toBe('Untitled');
	});

	it('strips trailing dots and spaces', () => {
		expect(sanitizeFileName('note. . .')).toBe('note');
	});

	it('strips leading dots', () => {
		expect(sanitizeFileName('.hidden')).toBe('hidden');
	});

	it('strips characters that interfere with links ([ ] # | ^)', () => {
		expect(sanitizeFileName('my [note] #1 ^ref')).toBe('my note 1 ref');
	});

	it('returns Untitled when the sanitized result is empty', () => {
		expect(sanitizeFileName('???')).toBe('Untitled');
		expect(sanitizeFileName('')).toBe('Untitled');
		expect(sanitizeFileName('   ')).toBe('Untitled');
	});

	it('handles a realistic note title from a web clip', () => {
		const input = 'My Note: A "Great" <Summary> of Things?';
		const result = sanitizeFileName(input);
		expect(result).not.toMatch(/[\?<>:\*\|"]/);
		expect(result).toBeTruthy();
	});
});

describe('genUid', () => {
	it('returns a string of the requested length', () => {
		expect(genUid(8)).toHaveLength(8);
		expect(genUid(16)).toHaveLength(16);
		expect(genUid(0)).toBe('');
	});

	it('returns hex characters only', () => {
		const uid = genUid(100);
		expect(uid).toMatch(/^[0-9a-f]+$/);
	});

	it('generates different values on successive calls', () => {
		const a = genUid(16);
		const b = genUid(16);
		// Theoretically could collide, but 16 hex chars makes it vanishingly unlikely
		expect(a).not.toBe(b);
	});
});

describe('truncateText', () => {
	it('returns text unchanged when under the limit', () => {
		expect(truncateText('hello', 10)).toBe('hello');
	});

	it('truncates and appends ellipses when over the limit', () => {
		expect(truncateText('hello world', 5)).toBe('hello...');
	});

	it('uses a custom ellipses string', () => {
		expect(truncateText('hello world', 5, '…')).toBe('hello…');
	});

	it('truncates when text.length equals the limit (uses strict < comparison)', () => {
		// "hello" has length 5, limit 5 => 5 < 5 is false => truncated
		expect(truncateText('hello', 5)).toBe('hello...');
		// Only strictly shorter strings pass through unchanged
		expect(truncateText('hell', 5)).toBe('hell');
	});
});

describe('extractErrorMessage', () => {
	it('returns the message from an Error object', () => {
		expect(extractErrorMessage(new Error('boom'))).toBe('boom');
	});

	it('returns the message from a plain object with a message property', () => {
		expect(extractErrorMessage({ message: 'oops' })).toBe('oops');
	});

	it('returns undefined for null', () => {
		expect(extractErrorMessage(null)).toBeUndefined();
	});

	it('returns undefined for a string', () => {
		expect(extractErrorMessage('not an object')).toBeUndefined();
	});

	it('returns undefined for an object without a message property', () => {
		expect(extractErrorMessage({ code: 404 })).toBeUndefined();
	});

	it('returns undefined when message is not a string', () => {
		expect(extractErrorMessage({ message: 42 })).toBeUndefined();
	});
});

describe('serializeFrontMatter', () => {
	it('returns an empty string for an empty object', () => {
		expect(serializeFrontMatter({})).toBe('');
	});

	it('wraps non-empty frontmatter in YAML fences', () => {
		const result = serializeFrontMatter({ title: 'Test' });
		expect(result).toMatch(/^---\n/);
		expect(result).toMatch(/\n---\n$/);
		expect(result).toContain('title');
	});
});

describe('uint8arrayToArrayBuffer', () => {
	it('converts a Uint8Array to an ArrayBuffer with the correct contents', () => {
		const input = new Uint8Array([72, 101, 108, 108, 111]);
		const result = uint8arrayToArrayBuffer(input as Uint8Array<ArrayBuffer>);
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(result)).toEqual(input);
	});

	it('handles an empty array', () => {
		const input = new Uint8Array([]);
		const result = uint8arrayToArrayBuffer(input as Uint8Array<ArrayBuffer>);
		expect(result.byteLength).toBe(0);
	});
});

describe('stringToUtf8', () => {
	it('converts an ASCII string to an ArrayBuffer', () => {
		const result = stringToUtf8('Hello');
		const bytes = new Uint8Array(result);
		expect(bytes).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
	});

	it('handles multi-byte UTF-8 characters', () => {
		const result = stringToUtf8('é');
		const bytes = new Uint8Array(result);
		// é is U+00E9, encoded as 0xC3 0xA9 in UTF-8
		expect(bytes).toEqual(new Uint8Array([0xC3, 0xA9]));
	});

	it('handles an empty string', () => {
		const result = stringToUtf8('');
		expect(result.byteLength).toBe(0);
	});
});
