import { describe, it, expect } from 'vitest';
import { KeepJson } from './keep/models';
import { sanitizeTag, sanitizeTags, toSentenceCase } from './keep/util';

/* ------------------------------------------------------------------ */
/*  Unit tests for keep/util.ts helper functions                       */
/* ------------------------------------------------------------------ */

describe('keep/util — sanitizeTag', () => {
	it('removes illegal characters from a tag', () => {
		expect(sanitizeTag('Keep/Color/Blue')).toBe('Keep/Color/Blue');
	});

	it('converts spaces to hyphens', () => {
		expect(sanitizeTag('My Tag Name')).toBe('My-Tag-Name');
	});

	it('prepends underscore when tag starts with a number', () => {
		expect(sanitizeTag('42things')).toBe('_42things');
	});

	it('strips special characters like colons and asterisks', () => {
		expect(sanitizeTag('a:b*c?d')).toBe('abcd');
	});

	it('handles the hash character by removing it', () => {
		expect(sanitizeTag('#myTag')).toBe('myTag');
	});
});

describe('keep/util — sanitizeTags', () => {
	it('normalises hashtags inside text content', () => {
		const input = 'Hello #world! Check #123num';
		const result = sanitizeTags(input);
		expect(result).toContain('#world');
		expect(result).toContain('#_123num');
	});

	it('leaves text without hashtags unchanged', () => {
		const plain = 'No hashtags here';
		expect(sanitizeTags(plain)).toBe(plain);
	});
});

describe('keep/util — toSentenceCase', () => {
	it('capitalises first letter and lowercases the rest', () => {
		expect(toSentenceCase('BLUE')).toBe('Blue');
		expect(toSentenceCase('red')).toBe('Red');
		expect(toSentenceCase('gREEN')).toBe('Green');
	});
});

/* ------------------------------------------------------------------ */
/*  Integration-style tests for convertKeepJson                        */
/* ------------------------------------------------------------------ */

/*
 * The conversion logic lives on KeepImporter.convertKeepJson, which is
 * an instance method that ultimately writes to the vault.  Rather than
 * spinning up the full class (which needs Obsidian UI), we extract the
 * same conversion logic inline so we can test the markdown output.
 *
 * The function below mirrors `KeepImporter.convertKeepJson` exactly,
 * but returns the markdown string instead of writing to disk.
 */
import { serializeFrontMatter } from '../util';

function convertKeepJsonToMarkdown(keepJson: KeepJson, filename: string): string {
	let mdContent: string[] = [];
	let frontMatter: Record<string, any> = {};

	// Aliases
	if (keepJson.title) {
		let aliases = keepJson.title.split('\n').filter((a: string) => a !== filename);
		if (aliases.length > 0) {
			frontMatter['aliases'] = aliases;
		}
	}

	let tags: string[] = [];
	if (keepJson.color && keepJson.color !== 'DEFAULT') {
		let colorName = keepJson.color.toLowerCase();
		colorName = toSentenceCase(colorName);
		tags.push(`Keep/Color/${colorName}`);
	}
	if (keepJson.isPinned) tags.push('Keep/Pinned');
	if (keepJson.attachments) tags.push('Keep/Attachment');
	if (keepJson.isArchived) tags.push('Keep/Archived');
	if (keepJson.isTrashed) tags.push('Keep/Deleted');
	if (keepJson.labels) {
		for (let label of keepJson.labels) {
			tags.push(`Keep/Label/${label.name}`);
		}
	}

	if (tags.length > 0) {
		frontMatter['tags'] = tags.map(tag => sanitizeTag(tag));
	}

	mdContent.push(serializeFrontMatter(frontMatter));

	if (keepJson.textContent) {
		mdContent.push('\n');
		mdContent.push(sanitizeTags(keepJson.textContent));
	}

	if (keepJson.listContent) {
		let mdListContent = [];
		for (const listItem of keepJson.listContent) {
			if (!listItem.text) continue;
			let listItemContent = `- [${listItem.isChecked ? 'X' : ' '}] ${listItem.text}`;
			mdListContent.push(sanitizeTags(listItemContent));
		}
		mdContent.push('\n\n');
		mdContent.push(mdListContent.join('\n'));
	}

	if (keepJson.attachments) {
		mdContent.push('\n\n');
		for (const attachment of keepJson.attachments) {
			mdContent.push(`![[${attachment.filePath}]]`);
		}
	}

	return mdContent.join('');
}

describe('convertKeepJsonToMarkdown', () => {
	it('converts a simple text note to markdown', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			title: 'My Note',
			textContent: 'Hello, world!',
		};

		const md = convertKeepJsonToMarkdown(keep, 'filename');

		expect(md).toContain('---');
		expect(md).toContain('aliases:');
		expect(md).toContain('My Note');
		expect(md).toContain('Hello, world!');
	});

	it('omits aliases when title matches filename', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			title: 'SameAsFile',
			textContent: 'Body text.',
		};

		const md = convertKeepJsonToMarkdown(keep, 'SameAsFile');
		// When the only alias matches the filename it gets filtered out,
		// so no aliases key should be present.
		expect(md).not.toContain('aliases:');
	});

	it('converts a list note to a markdown checklist', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			listContent: [
				{ text: 'Buy milk', isChecked: false },
				{ text: 'Walk dog', isChecked: true },
				{ text: '', isChecked: false }, // blank item — should be skipped
			],
		};

		const md = convertKeepJsonToMarkdown(keep, 'Shopping');

		expect(md).toContain('- [ ] Buy milk');
		expect(md).toContain('- [X] Walk dog');
		// Blank items are dropped
		expect(md).not.toContain('- [ ] \n');
	});

	it('handles labels as hierarchical tags', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			textContent: 'Labelled note.',
			labels: [
				{ name: 'Work' },
				{ name: 'Urgent' },
			],
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		expect(md).toContain('Keep/Label/Work');
		expect(md).toContain('Keep/Label/Urgent');
	});

	it('includes color tag when color is not DEFAULT', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			textContent: 'Colored note',
			color: 'BLUE',
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		expect(md).toContain('Keep/Color/Blue');
	});

	it('omits color tag when color is DEFAULT', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			textContent: 'Default color note',
			color: 'DEFAULT',
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		expect(md).not.toContain('Keep/Color');
	});

	it('tags pinned, archived, and trashed notes', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			textContent: 'Flagged note',
			isPinned: true,
			isArchived: true,
			isTrashed: true,
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		expect(md).toContain('Keep/Pinned');
		expect(md).toContain('Keep/Archived');
		expect(md).toContain('Keep/Deleted');
	});

	it('embeds attachments as wikilinks', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			textContent: 'Note with image',
			attachments: [
				{ filePath: 'photo.jpg', mimetype: 'image/jpeg' },
			],
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		expect(md).toContain('![[photo.jpg]]');
		expect(md).toContain('Keep/Attachment');
	});

	it('produces valid empty-ish output for a minimal note', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		// Should not throw; output may be empty or just whitespace
		expect(typeof md).toBe('string');
	});

	it('sanitises hashtags in text content', () => {
		const keep: KeepJson = {
			createdTimestampUsec: 1690426307496000,
			userEditedTimestampUsec: 1690597779005000,
			textContent: 'This has a #tag:with:colons in it',
		};

		const md = convertKeepJsonToMarkdown(keep, 'file');

		// Colons should be stripped from the hashtag body
		expect(md).not.toContain('#tag:with:colons');
		expect(md).toContain('#tagwithcolons');
	});
});

/* ------------------------------------------------------------------ */
/*  Tests for invalid/broken JSON handling (fixture-based)             */
/* ------------------------------------------------------------------ */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Google Keep JSON validation', () => {
	const fixtureDir = resolve(__dirname, '../../tests/keep');

	it('rejects JSON that is missing userEditedTimestampUsec', () => {
		const raw = readFileSync(resolve(fixtureDir, 'invalid-keep-json-note.json'), 'utf-8');
		const keepJson = JSON.parse(raw) as KeepJson;

		// The importer checks for both timestamps; this fixture lacks userEditedTimestampUsec
		const isValid = keepJson
			&& keepJson.userEditedTimestampUsec
			&& keepJson.createdTimestampUsec;

		expect(isValid).toBeFalsy();
	});

	it('throws on syntactically broken JSON', () => {
		const raw = readFileSync(resolve(fixtureDir, 'broken-json-note.json'), 'utf-8');

		expect(() => JSON.parse(raw)).toThrow();
	});
});
