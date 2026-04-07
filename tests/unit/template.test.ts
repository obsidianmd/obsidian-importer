import { describe, it, expect } from 'vitest';
import { applyTemplate, generateFrontmatter } from '../../src/template';

describe('applyTemplate', () => {
	it('replaces a single placeholder', () => {
		expect(applyTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
	});

	it('replaces multiple placeholders', () => {
		const result = applyTemplate('{{greeting}}, {{name}}!', {
			greeting: 'Hi',
			name: 'Alice',
		});
		expect(result).toBe('Hi, Alice!');
	});

	it('handles repeated placeholders', () => {
		expect(applyTemplate('{{x}} and {{x}}', { x: 'same' })).toBe('same and same');
	});

	it('preserves unmatched placeholders', () => {
		expect(applyTemplate('{{known}} {{unknown}}', { known: 'yes' })).toBe('yes {{unknown}}');
	});

	it('handles whitespace inside braces', () => {
		expect(applyTemplate('{{ name }}', { name: 'trimmed' })).toBe('trimmed');
		expect(applyTemplate('{{  name  }}', { name: 'trimmed' })).toBe('trimmed');
	});

	it('returns empty string for empty template', () => {
		expect(applyTemplate('', { name: 'test' })).toBe('');
	});

	it('returns empty string for falsy template', () => {
		expect(applyTemplate(null as any, { name: 'test' })).toBe('');
		expect(applyTemplate(undefined as any, { name: 'test' })).toBe('');
	});

	it('handles template with no placeholders', () => {
		expect(applyTemplate('plain text', { key: 'value' })).toBe('plain text');
	});

	it('handles empty data object', () => {
		expect(applyTemplate('{{name}}', {})).toBe('{{name}}');
	});

	it('replaces with empty string when value is empty', () => {
		expect(applyTemplate('before{{name}}after', { name: '' })).toBe('beforeafter');
	});

	it('handles multiline templates', () => {
		const template = '# {{title}}\n\n{{content}}\n\nBy {{author}}';
		const data = { title: 'My Note', content: 'Hello world', author: 'Alice' };
		expect(applyTemplate(template, data)).toBe('# My Note\n\nHello world\n\nBy Alice');
	});
});

describe('generateFrontmatter', () => {
	it('returns empty string when propertyNames is empty', () => {
		expect(generateFrontmatter({}, new Map(), new Map())).toBe('');
	});

	it('generates YAML frontmatter with simple string values', () => {
		const data = { title: 'My Note', author: 'Alice' };
		const names = new Map([
			['title', 'title'],
			['author', 'author'],
		]);
		const values = new Map([
			['title', '{{title}}'],
			['author', '{{author}}'],
		]);

		const result = generateFrontmatter(data, names, values);
		expect(result).toContain('---');
		expect(result).toContain('title:');
		expect(result).toContain('author:');
	});

	it('wraps result in --- delimiters', () => {
		const names = new Map([['k', 'key']]);
		const values = new Map([['k', '{{k}}']]);
		const result = generateFrontmatter({ k: 'val' }, names, values);

		const lines = result.split('\n');
		expect(lines[0]).toBe('---');
		expect(lines[lines.length - 1]).toBe('---');
	});

	it('skips fields with empty property names', () => {
		const names = new Map([
			['title', 'title'],
			['skip', ''],
		]);
		const values = new Map([
			['title', '{{title}}'],
			['skip', '{{skip}}'],
		]);

		const result = generateFrontmatter({ title: 'Test', skip: 'hidden' }, names, values);
		expect(result).toContain('title:');
		expect(result).not.toContain('skip');
	});

	it('skips fields with empty value templates', () => {
		const names = new Map([
			['title', 'title'],
			['empty', 'should-skip'],
		]);
		const values = new Map([
			['title', '{{title}}'],
			['empty', ''],
		]);

		const result = generateFrontmatter({ title: 'Test' }, names, values);
		expect(result).toContain('title:');
		expect(result).not.toContain('should-skip');
	});

	it('converts boolean-like values', () => {
		const names = new Map([['done', 'completed']]);
		const values = new Map([['done', '{{done}}']]);

		const result = generateFrontmatter({ done: 'true' }, names, values);
		expect(result).toContain('completed: true');
	});

	it('converts numeric values', () => {
		const names = new Map([['count', 'count']]);
		const values = new Map([['count', '{{count}}']]);

		const result = generateFrontmatter({ count: '42' }, names, values);
		expect(result).toContain('count: 42');
	});

	it('handles null/undefined-like string values', () => {
		const names = new Map([['val', 'value']]);
		const values = new Map([['val', '{{val}}']]);

		const result = generateFrontmatter({ val: 'null' }, names, values);
		// convertToYAML returns '' for null/undefined strings
		expect(result).toContain('value: ');
	});

	it('applies templates with mixed static text and placeholders', () => {
		const names = new Map([['name', 'label']]);
		const values = new Map([['name', 'prefix-{{name}}-suffix']]);

		const result = generateFrontmatter({ name: 'test' }, names, values);
		expect(result).toContain('label: "prefix-test-suffix"');
	});
});
