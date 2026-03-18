import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Bundle the converter once at module scope so all tests share the same build.
const outDir = mkdtempSync(join(tmpdir(), 'reflect-test-'));
const outFile = join(outDir, 'convert.mjs');
buildSync({
	entryPoints: ['src/formats/reflect/convert.ts'],
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	outfile: outFile,
});

const { convertDocument } = await import(pathToFileURL(outFile).href);

// Also bundle sanitizeFileName for the test helper's simplified idToSubject mapping.
const sfnOutFile = join(outDir, 'sanitize-file-name.mjs');
buildSync({
	entryPoints: ['src/sanitize-file-name.ts'],
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	outfile: sfnOutFile,
});
const { sanitizeFileName } = await import(pathToFileURL(sfnOutFile).href);

// Helper: load a note by id from a fixture file.
// Simplified idToSubject: uses sanitizeFileName(subject) directly. This matches
// production output for non-daily, non-colliding notes in the fixture set.
// Production also formats daily notes via moment and resolves duplicate titles
// with numeric suffixes (see getNoteTitle + getAvailableNotePath in reflect-json.ts).
function loadFixture(fixturePath) {
	const data = JSON.parse(readFileSync(fixturePath, 'utf8'));
	const idToSubject = new Map(
		data.notes.map(n => [n.id, sanitizeFileName(n.subject)])
	);
	return { data, idToSubject };
}

const sampleFixture = loadFixture('tests/reflect/sample-reflect-export.json');
const edgeCaseFixture = loadFixture('tests/reflect/hardening-edge-cases.json');

function getNoteJson(fixture, noteId) {
	const note = fixture.data.notes.find(n => n.id === noteId);
	if (!note) throw new Error(`Note ${noteId} not found in fixture`);
	return note.document_json;
}

describe('convertDocument smoke test', () => {
	it('converts a minimal document', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
		});
		const result = convertDocument(doc, new Map());
		assert.equal(result.markdown, 'Hello');
	});
});

describe('hard breaks', () => {
	it('converts hard breaks to <br> tags (note3)', () => {
		const json = getNoteJson(sampleFixture, 'note3');
		const result = convertDocument(json, sampleFixture.idToSubject);
		assert.ok(result.markdown.includes('Line one<br>\nLine two<br>\nLine three'),
			`Expected <br> between lines, got:\n${result.markdown}`);
	});

	it('converts inline hard breaks in a minimal fixture', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'A' },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'B' },
				],
			}],
		});
		const result = convertDocument(doc, new Map());
		assert.equal(result.markdown, 'A<br>\nB');
	});

	it('converts top-level hardBreak via convertNode path', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Above' }] },
				{ type: 'hardBreak' },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Below' }] },
			],
		});
		const result = convertDocument(doc, new Map());
		assert.ok(result.markdown.includes('<br>'),
			`Expected <br> from top-level hardBreak, got:\n${result.markdown}`);
	});
});
