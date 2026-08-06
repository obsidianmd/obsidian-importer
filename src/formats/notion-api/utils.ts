/**
 * Utility functions for Notion API importer
 */

/**
 * Placeholder types used during import
 */
export enum PlaceholderType {
	/** Inline mention of a page */
	NOTION_PAGE = 'NOTION_PAGE',
	/** Inline mention of a database */
	NOTION_DB = 'NOTION_DB',
	/** Child page within a synced block */
	SYNCED_CHILD_PAGE = 'SYNCED_CHILD_PAGE',
	/** Child database within a synced block */
	SYNCED_CHILD_DATABASE = 'SYNCED_CHILD_DATABASE',
	/** Database block placeholder */
	DATABASE_PLACEHOLDER = 'DATABASE_PLACEHOLDER'
}

/**
 * Create a placeholder string for later replacement
 * @param type - Type of placeholder
 * @param id - Notion ID (page, database, or block ID)
 * @returns Formatted placeholder string
 */
export function createPlaceholder(type: PlaceholderType, id: string): string {
	// All placeholders use wiki-link style: [[TYPE:id]]
	return `[[${type}:${id}]]`;
}

/**
 * Extract IDs from placeholders in content
 * @param content - Markdown content containing placeholders
 * @param type - Type of placeholder to extract
 * @returns Array of extracted IDs
 */
export function extractPlaceholderIds(content: string, type: PlaceholderType): string[] {
	const ids: string[] = [];
	
	// All placeholders use wiki-link style: [[TYPE:id]]
	const regex = new RegExp(`\\[\\[${type}:([a-f0-9-]+)\\]\\]`, 'g');
	let match;
	while ((match = regex.exec(content)) !== null) {
		ids.push(match[1]);
	}
	
	return ids;
}

