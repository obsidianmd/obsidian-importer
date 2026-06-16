import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KeepJson } from '../../src/formats/keep/models';
import { formatAnnotations } from '../../src/formats/keep/util';

test('returns empty string when a note has no annotations', () => {
	assert.equal(formatAnnotations(undefined), '');
	assert.equal(formatAnnotations([]), '');
});

test('formats Keep annotations as a Markdown section', () => {
	const fixturePath = join(
		dirname(fileURLToPath(import.meta.url)),
		'keep-note-with-annotations.json'
	);
	const note = JSON.parse(readFileSync(fixturePath, 'utf-8')) as KeepJson;

	assert.equal(
		formatAnnotations(note.annotations),
		[
			'## Annotations',
			'',
			'- [Submitting a Complaint to ICANN Contractual Compliance - ICANN](<https://www.icann.org/compliance/complaint>)',
			'- [Cloudflare - The Web Performance & Security Company](<https://www.cloudflare.com/>)',
			'  Here at Cloudflare, we make the Internet work the way it should. Offering CDN, DNS, DDoS protection and security, find out how we can help your site.',
		].join('\n')
	);
});

test('skips empty annotations and falls back to available fields', () => {
	assert.equal(
		formatAnnotations([
			{},
			{ url: 'https://example.com/path(with-parens)' },
			{ description: 'Only a description' },
		]),
		[
			'## Annotations',
			'',
			'- <https://example.com/path(with-parens)>',
			'- Only a description',
		].join('\n')
	);
});

test('escapes brackets in annotation link titles', () => {
	assert.equal(
		formatAnnotations([
			{
				title: 'Example [Docs]',
				url: 'https://example.com/docs',
			},
		]),
		[
			'## Annotations',
			'',
			'- [Example \\[Docs\\]](<https://example.com/docs>)',
		].join('\n')
	);
});
