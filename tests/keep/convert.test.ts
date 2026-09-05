/**
 * The Google Keep conversion, outside Obsidian.
 *
 * A parsed Takeout note goes in and markdown comes out, so it runs here
 * directly. The fixtures in notes/ are real Takeout exports lifted out of the
 * .zip in this directory, chosen to cover the states Keep records and
 * Obsidian has nowhere to put but tags: pinned, archived, deleted, coloured,
 * labelled, and a checklist rather than text.
 *
 * Each is recorded as the file the importer would write. Note that Keep's
 * checklists have no nesting in the export - sub-items arrive as ordinary
 * items - so the recorded notes are flat, which is a faithful conversion
 * rather than a lost level.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertKeepNote, formatAnnotations, keepTemplateVariables } from '../../src/formats/keep/convert';
import { hasValidKeepTimestamps, KeepJson } from '../../src/formats/keep/models';
import { sanitizeTags } from '../../src/formats/keep/util';
import { sanitizeFileName } from '../../src/util';
import { expectedFor, expectFile, fixtures } from '../helpers';

const NOTES = nodePath.join(__dirname, 'notes');

const notes = fixtures(NOTES, '.json');

function formatKeepText(keepJson: KeepJson): string {
	return convertKeepNote(keepJson, 'note').content.replace(/^\n/, '');
}

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .json in tests/keep/notes');
});

for (const note of notes) {
	test(`converts ${note.name}`, () => {
		const keepJson = JSON.parse(nodeFs.readFileSync(note.path, 'utf8')) as KeepJson;

		// The importer names the file after the export's own file name, which
		// is why a title matching it does not also become an alias.
		const filename = nodePath.basename(note.name, '.json');
		const { content } = convertKeepNote(keepJson, filename);

		expectFile(content, expectedFor(note, filename, `${sanitizeFileName(filename)}.md`), note.name);
	});
}

test('turns Keep state into tags', () => {
	const { content } = convertKeepNote({
		color: 'RED',
		isPinned: true,
		isArchived: true,
		isTrashed: true,
		tasks: [{ id: 'task-1' }],
		labels: [{ name: 'Recipes' }],
		title: 'Something',
		textContent: 'body',
		createdTimestampUsec: 0,
		userEditedTimestampUsec: 0,
	} as KeepJson, 'Something');

	for (const tag of ['Keep/Color/Red', 'Keep/Pinned', 'Keep/Task', 'Keep/Archived', 'Keep/Deleted', 'Keep/Label/Recipes']) {
		assert.ok(content.includes(tag), `expected ${tag} in:\n${content}`);
	}
});

test('converts microseconds to the milliseconds the vault wants', () => {
	const { ctime, mtime } = convertKeepNote({
		createdTimestampUsec: 1690425909718000,
		userEditedTimestampUsec: 1690864927360000,
	} as KeepJson, 'note');

	assert.equal(ctime, 1690425909718);
	assert.equal(mtime, 1690864927360);
});

test('accepts an unedited note and uses its creation time as its modification time', () => {
	const note = {
		createdTimestampUsec: 1380575747483000,
		userEditedTimestampUsec: 0,
	};

	assert.equal(hasValidKeepTimestamps(note), true);
	const { ctime, mtime } = convertKeepNote(note, 'note');
	assert.equal(ctime, 1380575747483);
	assert.equal(mtime, ctime);
});

test('rejects Keep data without valid timestamps', () => {
	assert.equal(hasValidKeepTimestamps({ createdTimestampUsec: 1380575747483000 }), false);
	assert.equal(hasValidKeepTimestamps({ createdTimestampUsec: 0, userEditedTimestampUsec: 0 }), false);
	assert.equal(hasValidKeepTimestamps({ createdTimestampUsec: 1380575747483000, userEditedTimestampUsec: -1 }), false);
});

test('offers simple list values to the shared template metadata editor', () => {
	const variables = keepTemplateVariables({
		textContent: 'Raw note text',
		listContent: [{ text: 'Raw checklist item', isChecked: false }],
		labels: [{ name: 'Recipes' }, { name: 'Later' }],
		sharees: [{ email: 'owner@example.com', isOwner: true, type: 'USER' }],
		tasks: [{ id: 'task-1' }],
		attachments: [{ filePath: 'drawing.png', mimetype: 'image/png' }],
		annotations: [{ url: 'https://example.com/' }, { title: 'No URL' }],
		createdTimestampUsec: 1690425909718000,
		userEditedTimestampUsec: 1690864927360000,
	} as KeepJson);

	assert.deepEqual(variables.labels, ['Recipes', 'Later']);
	assert.equal(variables.labelNames, undefined);
	assert.deepEqual(variables.sharees, [{ email: 'owner@example.com', isOwner: true, type: 'USER' }]);
	assert.deepEqual(variables.annotations, [{ url: 'https://example.com/' }, { title: 'No URL' }]);
	assert.equal(variables.annotationUrls, undefined);
	assert.equal(variables.tasks, undefined);
	assert.equal(variables.taskIds, undefined);
	assert.equal(variables.attachments, undefined);
	assert.equal(variables.textContent, undefined);
	assert.equal(variables.listContent, undefined);
	assert.equal(variables.createdTimestampUsec, undefined);
	assert.equal(variables.userEditedTimestampUsec, undefined);
});

test('formats annotation fallbacks and skips empty annotations', () => {
	assert.equal(formatAnnotations([
		{},
		{ title: 'Example [Docs]', url: 'https://example.com/docs' },
		{ url: 'https://example.com/path(with-parens)' },
		{ description: 'Only *a* description' },
	]), [
		'## Annotations',
		'',
		'- [Example \\[Docs\\]](<https://example.com/docs>)',
		'- <https://example.com/path(with-parens)>',
		'- Only \\*a\\* description',
	].join('\n'));
});

test('preserves Keep line breaks when the vault uses strict Markdown line breaks', () => {
	const { content } = convertKeepNote({
		textContent: 'first\nsecond\n\nthird',
		createdTimestampUsec: 0,
		userEditedTimestampUsec: 0,
	} as KeepJson, 'note', true);

	assert.ok(content.endsWith('\nfirst  \nsecond  \n  \nthird'));
});

test('does not add strict line-break spaces inside fenced code', () => {
	const { content } = convertKeepNote({
		textContentHtml: '<pre><code>const a = 1;\nconst b = 2;</code></pre>',
		createdTimestampUsec: 0,
		userEditedTimestampUsec: 0,
	}, 'note', true);

	assert.ok(content.endsWith('\n```\nconst a = 1;\nconst b = 2;\n```'));
});

test('only normalizes hashtags that match labels exported with the note', () => {
	const text = [
		'#label with spaces and (#label.with.symbols), **#label.with.symbols**',
		'https://example.com/page#fragment https://example.com/#label.with.symbols issue#658 #ordinary:',
		'#label.with.symbols',
	].join('\n');

	assert.equal(sanitizeTags(text, ['label with spaces', 'label.with.symbols']), [
		'#label-with-spaces and (#labelwithsymbols), **#labelwithsymbols**',
		'https://example.com/page#fragment https://example.com/#label.with.symbols issue#658 #ordinary:',
		'#labelwithsymbols',
	].join('\n'));
});

test('converts Keep rich-text HTML formatting to Markdown', () => {
	const formatted = formatKeepText({
		textContent: 'Bold, italic, underlined, and struck.',
		textContentHtml: [
			'<h1>Heading</h1>',
			'<p>',
			'<span style="font-weight:700">Bold</span>, ',
			'<span style="font-style:italic">italic</span>, ',
			'<span style="text-decoration:underline">underlined</span>, and ',
			'<span style="text-decoration:line-through">struck</span>.',
			'</p>',
		].join(''),
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	});

	assert.equal(formatted, [
		'# Heading',
		'',
		'**Bold**, _italic_, <u>underlined</u>, and ~~struck~~.',
	].join('\n'));
});

test('prefers rich-text HTML while keeping plain text as a fallback', () => {
	const timestamps = { createdTimestampUsec: 1, userEditedTimestampUsec: 1 };
	assert.equal(formatKeepText({ ...timestamps, textContent: 'plain' }), 'plain');

	const { content } = convertKeepNote({
		...timestamps,
		textContent: 'plain',
		textContentHtml: '<p><strong>formatted</strong></p>',
	}, 'note');
	assert.ok(content.endsWith('\n**formatted**'));
});

test('does not let an empty plain-text field hide an HTML body', () => {
	assert.equal(formatKeepText({
		textContent: '',
		textContentHtml: '<p>real body</p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), 'real body');
});

test('falls back to plain text when formatted HTML contains no body', () => {
	assert.equal(formatKeepText({
		textContent: 'fallback body',
		textContentHtml: '<p><strong></strong></p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), 'fallback body');
});

test('does not duplicate semantic or inherited rich-text formatting', () => {
	const formatted = formatKeepText({
		textContentHtml: [
			'<h1 style="font-weight:700">Heading</h1>',
			'<p><b style="font-weight:bold">bold</b> ',
			'<i style="font-style:italic">italic</i> ',
			'<s style="text-decoration:line-through">struck</s></p>',
			'<p><span style="font-weight:700">a<span style="font-weight:700">b</span></span></p>',
		].join(''),
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	});

	assert.equal(formatted, [
		'# Heading',
		'',
		'**bold** _italic_ ~~struck~~',
		'',
		'**ab**',
	].join('\n'));
});

test('uses rich HTML when it preserves structures absent from plain text', () => {
	assert.equal(formatKeepText({
		textContent: 'Quote\nExample',
		textContentHtml: '<blockquote>Quote</blockquote><p><a href="https://example.com">Example</a></p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), '> Quote\n\n[Example](https://example.com)');
});

test('keeps bare Keep autolinks as plain URLs while preserving named links', () => {
	assert.equal(formatKeepText({
		textContent: 'Recipe https://example.com/soup',
		textContentHtml: '<p>Recipe <a href="https://example.com/soup">https://example.com/soup</a></p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), 'Recipe https://example.com/soup');

	assert.equal(formatKeepText({
		textContent: 'Recipe',
		textContentHtml: '<p><a href="https://example.com/soup">Recipe</a></p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), '[Recipe](https://example.com/soup)');
});

test('converts rich text in Keep checklist items', () => {
	const { content } = convertKeepNote({
		listContent: [
			{ textHtml: '<p><span style="font-weight:700">rich item</span></p>', isChecked: false },
			{ text: 'plain item', isChecked: true },
		],
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}, 'note');

	assert.ok(content.endsWith('\n\n- [ ] **rich item**\n- [X] plain item'));
});

test('keeps every rich-text checklist block inside its item', () => {
	const { content } = convertKeepNote({
		listContent: [{
			textHtml: [
				'<p><b>first</b></p>',
				'<h1><span style="font-weight:700">second</span></h1>',
				'<h2>third</h2>',
			].join(''),
			isChecked: false,
		}],
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}, 'note');

	assert.ok(content.endsWith('\n\n- [ ] **first**<br>**second**<br>third'));
});

test('preserves literal hash-prefixed text in rich checklist items', () => {
	const { content } = convertKeepNote({
		listContent: [{
			textHtml: '<p># not a heading</p>',
			isChecked: false,
		}],
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}, 'note');

	assert.ok(content.endsWith('\n\n- [ ] # not a heading'));
});

test('styled void elements do not add empty formatting markers', () => {
	assert.equal(formatKeepText({
		textContentHtml: '<p><img src="image.png" style="font-weight:700"></p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), '![](image.png)');
});

test('preserves semantic underline from Keep rich text', () => {
	assert.equal(formatKeepText({
		textContentHtml: '<p><u>underlined</u></p>',
		createdTimestampUsec: 1,
		userEditedTimestampUsec: 1,
	}), '<u>underlined</u>');
});
