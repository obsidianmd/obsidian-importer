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

describe('tag stripping — empty item suppression', () => {
	it('drops tag-only legacy list item and still collects tag (note17)', () => {
		const json = getNoteJson(sampleFixture, 'note17');
		const result = convertDocument(json, sampleFixture.idToSubject, '17 Daily With Backlink', { stripInlineTags: true });
		// Should not contain a standalone bare bullet line
		const lines = result.markdown.split('\n');
		const bareBullets = lines.filter(l => /^\s*-\s*$/.test(l));
		assert.equal(bareBullets.length, 0,
			`Expected no bare bullet lines, found: ${JSON.stringify(bareBullets)}`);
		// Tag should still be collected
		assert.ok(result.tags.has('meeting'),
			`Expected tags to contain "meeting", got: ${[...result.tags]}`);
		// The backlink to note14 should still be present in the output
		assert.ok(result.markdown.includes('[['),
			`Expected backlink to be present in output, got:\n${result.markdown}`);
	});

	it('drops tag-only modern bulletList item with stripInlineTags', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [{
							type: 'paragraph',
							content: [{ type: 'tag', attrs: { id: 'sometag', label: 'sometag' } }],
						}],
					},
					{
						type: 'listItem',
						content: [{
							type: 'paragraph',
							content: [{ type: 'text', text: 'Visible item' }],
						}],
					},
				],
			}],
		});
		const result = convertDocument(doc, new Map(), undefined, { stripInlineTags: true });
		// Positive: visible item is preserved
		assert.ok(result.markdown.includes('- Visible item'),
			`Expected visible item preserved, got:\n${result.markdown}`);
		// Negative: no bare bullets from the stripped tag-only item
		assert.ok(!result.markdown.includes('- \n'),
			`Expected no bare bullet, got:\n${result.markdown}`);
		// Tag still collected
		assert.ok(result.tags.has('sometag'));
		// Output should contain exactly one bullet item
		const bulletLines = result.markdown.split('\n').filter(l => /^- /.test(l));
		assert.equal(bulletLines.length, 1,
			`Expected exactly 1 bullet line, got: ${JSON.stringify(bulletLines)}`);
	});

	it('drops tag-only taskList item with stripInlineTags', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{
				type: 'taskList',
				content: [
					{
						type: 'taskListItem',
						attrs: { checked: false },
						content: [{
							type: 'paragraph',
							content: [{ type: 'tag', attrs: { id: 'tasktag', label: 'tasktag' } }],
						}],
					},
					{
						type: 'taskListItem',
						attrs: { checked: true },
						content: [{
							type: 'paragraph',
							content: [{ type: 'text', text: 'Done task' }],
						}],
					},
				],
			}],
		});
		const result = convertDocument(doc, new Map(), undefined, { stripInlineTags: true });
		// Positive: visible task preserved
		assert.ok(result.markdown.includes('- [x] Done task'),
			`Expected visible task preserved, got:\n${result.markdown}`);
		// Negative: no bare checkbox from stripped item
		const lines = result.markdown.split('\n');
		const bareCheckboxes = lines.filter(l => /^\s*- \[.\]\s*$/.test(l));
		assert.equal(bareCheckboxes.length, 0,
			`Expected no bare checkboxes, got: ${JSON.stringify(bareCheckboxes)}`);
		// Tag still collected
		assert.ok(result.tags.has('tasktag'));
	});

	it('preserves archived annotation even when text is empty', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{
				type: 'list',
				attrs: { kind: 'bullet', checked: false, archived: true },
				content: [{
					type: 'paragraph',
					content: [{ type: 'tag', attrs: { id: 'archivedtag', label: 'archivedtag' } }],
				}],
			}],
		});
		const result = convertDocument(doc, new Map(), undefined, { stripInlineTags: true });
		// Archived comment should be preserved (line.trim() includes it so guard doesn't skip)
		assert.ok(result.markdown.includes('<!-- archived -->'),
			`Expected archived comment preserved, got:\n${result.markdown}`);
		// The archived item should still have a bullet prefix
		assert.ok(result.markdown.includes('- '),
			`Expected bullet prefix for archived item, got:\n${result.markdown}`);
	});
});

describe('block-first list items — heading on prefix line', () => {
	it('puts heading on same line as bullet prefix (list-edge-cases)', () => {
		const json = getNoteJson(edgeCaseFixture, 'list-edge-cases');
		const result = convertDocument(json, edgeCaseFixture.idToSubject);
		// Positive: heading is on the same line as the bullet prefix
		assert.ok(result.markdown.includes('- ### Heading inside list item'),
			`Expected "- ### Heading inside list item", got:\n${result.markdown}`);
		// Negative: no bare bullet followed by indented heading
		assert.ok(!result.markdown.includes('- \n\t### Heading inside list item'),
			`Expected heading NOT on separate indented line, got:\n${result.markdown}`);
	});

	it('does NOT merge heading onto task list prefix (task items unchanged)', () => {
		const json = getNoteJson(edgeCaseFixture, 'list-edge-cases');
		const result = convertDocument(json, edgeCaseFixture.idToSubject);
		// Task list items should keep the current behavior (heading on separate line)
		// Positive: verify the task item heading content exists in output
		assert.ok(result.markdown.includes('Task heading child'),
			`Expected task heading content in output, got:\n${result.markdown}`);
		// Negative: heading should NOT be merged onto checkbox prefix
		assert.ok(!result.markdown.includes('- [x] #### Task heading child'),
			`Task item heading should NOT be merged onto prefix line, got:\n${result.markdown}`);
	});

	it('puts heading on prefix line for legacy bullet list', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{
				type: 'list',
				attrs: { kind: 'bullet', checked: false },
				content: [
					{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Legacy heading' }] },
					{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
				],
			}],
		});
		const result = convertDocument(doc, new Map());
		// Positive: heading merged onto bullet prefix
		assert.ok(result.markdown.includes('- ## Legacy heading'),
			`Expected "- ## Legacy heading", got:\n${result.markdown}`);
		// Positive: body text preserved as continuation
		assert.ok(result.markdown.includes('Body text'),
			`Expected body text preserved, got:\n${result.markdown}`);
	});

	it('preserves blockquote on separate line (not merged)', () => {
		const doc = JSON.stringify({
			type: 'doc',
			content: [{
				type: 'bulletList',
				content: [{
					type: 'listItem',
					content: [{
						type: 'blockquote',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }],
					}],
				}],
			}],
		});
		const result = convertDocument(doc, new Map());
		// Positive: blockquote content present and indented under bullet
		assert.ok(result.markdown.includes('> Quoted'),
			`Expected blockquote content in output, got:\n${result.markdown}`);
		// Negative: blockquote should NOT be merged onto bullet prefix line
		assert.ok(!result.markdown.includes('- > Quoted'),
			`Blockquote should not be merged onto bullet prefix, got:\n${result.markdown}`);
	});
});
