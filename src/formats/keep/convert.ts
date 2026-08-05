/**
 * Turning a Keep note into markdown, separate from the importer that writes it.
 *
 * A parsed Takeout note goes in and the note's body comes out, along with the
 * timestamps the importer stamps onto the file afterwards. Nothing here
 * touches Obsidian or a vault.
 */
import { FrontMatterCache } from 'obsidian';
import { serializeFrontMatter } from '../../util';
import { KeepJson } from './models';
import { sanitizeTag, sanitizeTags, toSentenceCase } from './util';

/** A note as the conversion produces it, before anything writes it down. */
export interface ConvertedKeepNote {
	/** Frontmatter and body, ready to write. */
	content: string;
	/** Keep records microseconds; these are milliseconds, as the vault wants. */
	ctime: number;
	mtime: number;
}

/**
 * Keep's own state becomes tags, since Obsidian has nowhere else to put it:
 * a colour, whether it was pinned, archived or deleted, and its labels.
 */
function collectTags(keepJson: KeepJson): string[] {
	const tags: string[] = [];

	if (keepJson.color && keepJson.color !== 'DEFAULT') {
		tags.push(`Keep/Color/${toSentenceCase(keepJson.color.toLowerCase())}`);
	}
	if (keepJson.isPinned) tags.push('Keep/Pinned');
	if (keepJson.attachments) tags.push('Keep/Attachment');
	if (keepJson.isArchived) tags.push('Keep/Archived');
	if (keepJson.isTrashed) tags.push('Keep/Deleted');

	for (const label of keepJson.labels ?? []) {
		tags.push(`Keep/Label/${label.name}`);
	}

	return tags;
}

/**
 * @param filename The name the note will be saved under. A title that matches
 *                 it says nothing extra, so only the rest becomes an alias.
 */
export function convertKeepNote(keepJson: KeepJson, filename: string): ConvertedKeepNote {
	const frontMatter: FrontMatterCache = {};

	if (keepJson.title) {
		const aliases = keepJson.title.split('\n').filter(alias => alias !== filename);
		if (aliases.length > 0) frontMatter['aliases'] = aliases;
	}

	const tags = collectTags(keepJson);
	if (tags.length > 0) frontMatter['tags'] = tags.map(tag => sanitizeTag(tag));

	const parts: string[] = [serializeFrontMatter(frontMatter)];

	if (keepJson.textContent) {
		parts.push('\n', sanitizeTags(keepJson.textContent));
	}

	if (keepJson.listContent) {
		const items = keepJson.listContent
			// Don't put in blank checkbox items
			.filter(item => item.text)
			.map(item => sanitizeTags(`- [${item.isChecked ? 'X' : ' '}] ${item.text}`));

		parts.push('\n\n', items.join('\n'));
	}

	if (keepJson.attachments) {
		parts.push('\n\n');
		for (const attachment of keepJson.attachments) {
			parts.push(`![[${attachment.filePath}]]`);
		}
	}

	return {
		content: parts.join(''),
		ctime: keepJson.createdTimestampUsec / 1000,
		mtime: keepJson.userEditedTimestampUsec / 1000,
	};
}
