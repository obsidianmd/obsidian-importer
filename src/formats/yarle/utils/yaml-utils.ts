/**
 * Escapes a string value for use in YAML frontmatter.
 * Handles special characters like colons, quotes, newlines, etc.
 *
 * @param value - The string value to escape
 * @returns YAML-safe string representation
 */
export function escapeYamlValue(value: string | undefined): string {
	if (!value) {
		return '';
	}

	const trimmed = value.trim();

	// Check if value needs quoting
	// YAML special characters that require quoting: : { } [ ] , & * # ? | - < > = ! % @ `
	// Also quote if starts with quote, or contains newlines
	const needsQuoting = /[:\{\}\[\],&*#?\|\-<>=!%@`]|^['"]|[\r\n]/.test(trimmed);

	if (needsQuoting) {
		// Use JSON.stringify which handles escaping quotes, newlines, etc.
		return JSON.stringify(trimmed);
	}

	return trimmed;
}
