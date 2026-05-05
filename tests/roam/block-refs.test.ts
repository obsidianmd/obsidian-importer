import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blockRefRegex, extractBlockReferenceUIDs } from '../../src/formats/roam/block-refs';

// The original (pre-fix) regex used a lookbehind and a lookahead, which is not
// supported on iOS < 16.4. The new regex must produce identical UID extraction
// results across all realistic inputs. Tests below verify that equivalence.
const originalLookbehindRegex = /(?<=\(\()\b(.*?)\b(?=\)\))/g;

function originalExtract(input: string): string[] {
	// Mirrors the pre-fix code: `inputString.match(blockRefRegex)`.
	return input.match(originalLookbehindRegex) ?? [];
}

test('extracts a single block reference UID', () => {
	assert.deepEqual(extractBlockReferenceUIDs('((P68pRja7i))'), ['P68pRja7i']);
});

test('extracts multiple block reference UIDs', () => {
	const input = 'see ((abc123)) and also ((def456)) for context';
	assert.deepEqual(extractBlockReferenceUIDs(input), ['abc123', 'def456']);
});

test('returns empty array when no block references present', () => {
	assert.deepEqual(extractBlockReferenceUIDs('plain text with no refs'), []);
});

test('returns empty array for empty parens', () => {
	assert.deepEqual(extractBlockReferenceUIDs('(())'), []);
});

test('does not match parens containing only whitespace', () => {
	assert.deepEqual(extractBlockReferenceUIDs('(( ))'), []);
});

test('extracts UID embedded in alias syntax', () => {
	const input = '[Block Alias](((JF3iFJPKu)))';
	assert.deepEqual(extractBlockReferenceUIDs(input), ['JF3iFJPKu']);
});

test('extracts UID inside embed syntax', () => {
	const input = '{{[[embed]]: ((sHQRa0Wan))}}';
	assert.deepEqual(extractBlockReferenceUIDs(input), ['sHQRa0Wan']);
});

test('extracts UID alongside English-text parenthetical phrases', () => {
	// Real fixture from small-test-graph.json: two non-UID parentheticals plus
	// one real UID. The non-UID phrases like `((and interesting))` should also
	// match the regex (they look syntactically identical) — this matches the
	// original lookbehind regex's behavior, downstream code falls back to
	// using the matched text when no block exists for the UID.
	const input = 'A very long ((and interesting)) quote collapsed and one ((open)) also one with regular ((xNaGTlLLA)).';
	assert.deepEqual(extractBlockReferenceUIDs(input), ['and interesting', 'open', 'xNaGTlLLA']);
});

test('extracts UID from roam/render syntax', () => {
	const input = '{{[[roam/render]]:((5juEDRY_n))}}';
	assert.deepEqual(extractBlockReferenceUIDs(input), ['5juEDRY_n']);
});

test('handles UIDs containing hyphens and underscores', () => {
	const input = '((abc-def_123))';
	assert.deepEqual(extractBlockReferenceUIDs(input), ['abc-def_123']);
});

test('does not match when leading or trailing chars are non-word', () => {
	// `\b` requires a word character on the inside edge of the parens.
	assert.deepEqual(extractBlockReferenceUIDs('((-abc))'), []);
	assert.deepEqual(extractBlockReferenceUIDs('((abc-))'), []);
});

test('replaces block references using the regex', () => {
	// Mirrors the replacement on line 452 of roam-json.ts.
	const uids = extractBlockReferenceUIDs('see ((abc)) and ((def))');
	let i = 0;
	const result = 'see ((abc)) and ((def))'.replace(blockRefRegex, () => `<${uids[i++]}>`);
	assert.equal(result, 'see <abc> and <def>');
});

test('matchAll then replace on the same regex remains consistent', () => {
	// Guards against regex lastIndex state leaking between calls. The exported
	// regex has the `g` flag; matchAll spec creates an internal iterator and
	// must not mutate lastIndex on the source regex.
	const input = '((one))((two))((three))';
	const first = extractBlockReferenceUIDs(input);
	const second = extractBlockReferenceUIDs(input);
	assert.deepEqual(first, ['one', 'two', 'three']);
	assert.deepEqual(second, first);
});

// Equivalence sweep: any input that the original lookbehind regex matched must
// produce the same UID list under the new implementation.
const equivalenceCorpus = [
	'',
	'((abc))',
	'((P68pRja7i))',
	'see ((abc123)) and ((def456))',
	'plain text with no refs',
	'(())',
	'(( ))',
	'[Block Alias](((JF3iFJPKu)))',
	'{{[[embed]]: ((sHQRa0Wan))}}',
	'{{[[roam/render]]:((5juEDRY_n))}}',
	'A very long ((and interesting)) quote ((open)) ((xNaGTlLLA)).',
	'((abc-def_123))',
	'((1234))',
	'((-abc))',
	'((abc-))',
	'((a))',
	'(((nested)))',
	'((wrap [[page]] inside))',
];

for (const input of equivalenceCorpus) {
	test(`equivalent to original lookbehind regex: ${JSON.stringify(input)}`, () => {
		assert.deepEqual(extractBlockReferenceUIDs(input), originalExtract(input));
	});
}

// Sweep against every block string in the real test fixture to make sure no
// unexpected divergence appears in production-shaped data.
test('equivalent across all block strings in small-test-graph.json', () => {
	const fixturePath = join(
		dirname(fileURLToPath(import.meta.url)),
		'small-test-graph.json'
	);
	const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));

	const blockStrings: string[] = [];
	function walk(node: { string?: string, children?: unknown[] }) {
		if (typeof node.string === 'string') blockStrings.push(node.string);
		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child as typeof node);
		}
	}
	for (const page of data) walk(page);

	let comparedWithRefs = 0;
	for (const s of blockStrings) {
		const expected = originalExtract(s);
		const actual = extractBlockReferenceUIDs(s);
		assert.deepEqual(actual, expected, `mismatch on input: ${JSON.stringify(s)}`);
		if (expected.length > 0) comparedWithRefs++;
	}

	// Sanity: the fixture must contain at least some block refs, otherwise we
	// haven't actually exercised the regex on real data.
	assert.ok(comparedWithRefs > 0, 'fixture contained no block references');
});
