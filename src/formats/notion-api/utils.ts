/**
 * Utility functions for Notion API importer
 */

/**
 * Extract Page ID from URL or direct ID input
 * Supported formats:
 * - https://www.notion.so/Page-Title-abc123def456
 * - https://www.notion.so/workspace/Page-Title-abc123def456?v=xxx
 * - abc123def456
 * - abc123def456789012345678901234567890
 */
export function extractPageId(input: string): string | null {
	// Remove whitespace
	input = input.trim();

	// If it's a URL, extract ID
	if (input.startsWith('http')) {
		// Remove query parameters
		const urlWithoutQuery = input.split('?')[0];
		
		// Find the last dash in path
		const lastDashIndex = urlWithoutQuery.lastIndexOf('-');
		
		if (lastDashIndex !== -1) {
			// Extract 32 characters after the dash
			const pageId = urlWithoutQuery.substring(lastDashIndex + 1);
			
			// Validate it's 32 hex characters
			if (pageId.length === 32 && /^[a-f0-9]{32}$/i.test(pageId)) {
				return formatPageId(pageId);
			}
		}
		
		return null;
	}
	else {
		// Direct ID input
		return formatPageId(input);
	}
}

/**
 * Format Page ID to standard UUID format (with dashes)
 */
export function formatPageId(id: string): string {
	// Remove all dashes
	id = id.replace(/-/g, '');

	// If length is not 32, return original (possibly invalid)
	if (id.length !== 32) {
		return id;
	}

	// Format as UUID: 8-4-4-4-12
	return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

