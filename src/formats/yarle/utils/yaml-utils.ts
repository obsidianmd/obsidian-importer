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

	// YAML doesn't allow newlines in simple quoted strings. Replace with a
	// space, as there's no way to tell whether the user intended the linebreaks
	// to be maintained (via a literal "|" block) or ignored (via a folded ">"
	// block).
	if (/[\r\n]/.test(trimmed)) {
		const singleLine = trimmed.replace(/\s*[\r\n]+\s*/g, ' ');
		return escapeYamlValue(singleLine);
	}

	// Quote the string if it starts with a YAML special character, or contains
	// a colon followed by a space.
	const needsQuoting =
		/^[-?:,\[\]{}#&*!|>'"%@`]/.test(trimmed) ||
		/:\s/.test(trimmed);

	if (needsQuoting) {
		// Backslashes and double-quotes must be escaped inside of YAML
		// double-quoted strings. So we replace \ -> \\ and " -> \", before
		// wrapping in double quotes.
		return '"' + trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
	}

	return trimmed;
}
