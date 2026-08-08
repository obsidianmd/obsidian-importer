import { FrontMatterCache } from 'obsidian';
import { serializeFrontMatter } from '../../util';
import { KeepJson } from './models';
import { sanitizeTag, sanitizeTags, toSentenceCase } from './util';

export interface ConvertedKeepNote {
	content: string;
	// Keep stores microseconds; the vault expects milliseconds.
	ctime: number;
	mtime: number;
}

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
