import type { OnenotePage } from '@microsoft/microsoft-graph-types';
import type { DataWriteOptions, FrontMatterCache } from 'obsidian';

function parseOneNoteDate(dateTime: string | null | undefined): number | null {
	if (!dateTime) return null;
	const timestamp = Date.parse(dateTime);
	return Number.isNaN(timestamp) ? null : timestamp;
}

function toISOString(timestamp: number | null): string | undefined {
	return timestamp === null ? undefined : new Date(timestamp).toISOString();
}

export function getOneNoteDateProperties(page: OnenotePage): FrontMatterCache {
	const created = parseOneNoteDate(page.createdDateTime);
	const updated = parseOneNoteDate(page.lastModifiedDateTime);
	const frontMatter: FrontMatterCache = {};

	const createdDate = toISOString(created);
	if (createdDate) frontMatter.created = createdDate;

	const updatedDate = toISOString(updated);
	if (updatedDate) frontMatter.updated = updatedDate;

	return frontMatter;
}

export function getOneNoteDateWriteOptions(page: OnenotePage): DataWriteOptions {
	const created = parseOneNoteDate(page.createdDateTime);
	const lastModified = parseOneNoteDate(page.lastModifiedDateTime);
	const now = Date.now();

	return {
		ctime: created ?? lastModified ?? now,
		mtime: lastModified ?? created ?? now,
	};
}
