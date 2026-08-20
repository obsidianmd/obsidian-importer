import { FrontMatterCache } from 'obsidian';
import { serializeFrontMatter } from '../../util';
import { KeepAnnotation, KeepJson } from './models';
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

export function keepTemplateVariables(keepJson: KeepJson): Record<string, unknown> {
	return {
		...keepJson,
		labelNames: keepJson.labels?.map(label => label.name).filter(Boolean) ?? [],
		taskIds: keepJson.tasks?.map(task => task.id).filter(Boolean) ?? [],
		annotationUrls: keepJson.annotations
			?.map(annotation => annotation.url?.trim())
			.filter((url): url is string => !!url) ?? [],
	};
}

function normalizeAnnotationText(value: string | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeMarkdownText(text: string): string {
	return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function annotationUrl(url: string): string {
	return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

function annotationPrimaryText(annotation: KeepAnnotation): string {
	const title = normalizeAnnotationText(annotation.title);
	const url = normalizeAnnotationText(annotation.url);
	const description = normalizeAnnotationText(annotation.description);

	if (title && url) return `[${escapeMarkdownText(title)}](${annotationUrl(url)})`;
	if (url) return annotationUrl(url);
	if (title) return escapeMarkdownText(title);
	return escapeMarkdownText(description);
}

export function formatAnnotations(annotations: KeepAnnotation[] | undefined): string {
	const items: string[] = [];

	for (const annotation of annotations ?? []) {
		const primary = annotationPrimaryText(annotation);
		if (!primary) continue;

		items.push(`- ${primary}`);

		const title = normalizeAnnotationText(annotation.title);
		const description = normalizeAnnotationText(annotation.description);
		if (description && description !== title && escapeMarkdownText(description) !== primary) {
			items.push(`  ${escapeMarkdownText(description)}`);
		}
	}

	return items.length > 0 ? `## Annotations\n\n${items.join('\n')}` : '';
}

export function convertKeepNote(
	keepJson: KeepJson,
	filename: string,
	strictLineBreaks = false,
	resolveAttachment: (sourcePath: string) => string = sourcePath => sourcePath
): ConvertedKeepNote {
	const frontMatter: FrontMatterCache = {};

	if (keepJson.title) {
		const aliases = keepJson.title.split('\n').filter(alias => alias !== filename);
		if (aliases.length > 0) frontMatter['aliases'] = aliases;
	}

	const tags = collectTags(keepJson);
	if (tags.length > 0) frontMatter['tags'] = tags.map(tag => sanitizeTag(tag));

	const parts: string[] = [serializeFrontMatter(frontMatter)];

	if (keepJson.textContent) {
		let text = sanitizeTags(keepJson.textContent);
		if (strictLineBreaks) text = text.replace(/(?<! {2})\r?\n/g, '  \n');
		parts.push('\n', text);
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
			parts.push(`![[${resolveAttachment(attachment.filePath)}]]`);
		}
	}

	const annotations = formatAnnotations(keepJson.annotations);
	if (annotations) parts.push('\n\n', annotations);

	return {
		content: parts.join(''),
		ctime: keepJson.createdTimestampUsec / 1000,
		mtime: keepJson.userEditedTimestampUsec / 1000,
	};
}
