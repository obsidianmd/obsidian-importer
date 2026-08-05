/**
 * CSV parsing, separate from the importer that uses it.
 *
 * Nothing here touches Obsidian or a vault: it takes the text of a file and
 * returns its headers and rows. That is what makes it testable on its own, and
 * what would let it run anywhere the rest of a conversion does.
 */

export interface CSVRow {
	[key: string]: string;
}

export interface ParsedCSV {
	headers: string[];
	rows: CSVRow[];
}

/**
 * Split into lines, respecting newlines inside quoted fields.
 *
 * A field may contain a line break, so this cannot be a split on \n. Blank
 * lines are dropped, and all three line endings are accepted.
 */
export function splitCSVLines(content: string): string[] {
	const lines: string[] = [];
	let currentLine = '';
	let inQuotes = false;

	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		const nextChar = content[i + 1];

		if (char === '"') {
			currentLine += char; // Always add the quote to the line
			if (inQuotes && nextChar === '"') {
				// Escaped quote - add the second quote too
				currentLine += '"';
				i++; // Skip next quote
			}
			else {
				// Toggle quote state
				inQuotes = !inQuotes;
			}
		}
		else if (char === '\n' && !inQuotes) {
			// End of line
			if (currentLine.trim().length > 0) {
				lines.push(currentLine);
			}
			currentLine = '';
		}
		else if (char === '\r' && nextChar === '\n' && !inQuotes) {
			// Windows line ending
			if (currentLine.trim().length > 0) {
				lines.push(currentLine);
			}
			currentLine = '';
			i++; // Skip \n
		}
		else if (char === '\r' && !inQuotes) {
			// Mac line ending
			if (currentLine.trim().length > 0) {
				lines.push(currentLine);
			}
			currentLine = '';
		}
		else {
			currentLine += char;
		}
	}

	// Add last line if exists
	if (currentLine.trim().length > 0) {
		lines.push(currentLine);
	}

	return lines;
}

/** Split one line into fields, unwrapping quotes and unescaping doubled ones. */
export function parseCSVLine(line: string): string[] {
	const values: string[] = [];
	let currentValue = '';
	let inQuotes = false;
	let startOfField = true;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const nextChar = line[i + 1];

		if (char === '"' && startOfField) {
			// Starting a quoted field
			inQuotes = true;
			startOfField = false;
		}
		else if (char === '"' && inQuotes) {
			if (nextChar === '"') {
				// Escaped quote - add one quote to the value
				currentValue += '"';
				i++; // Skip the next quote
			}
			else {
				// End of quoted field
				inQuotes = false;
			}
		}
		else if (char === ',' && !inQuotes) {
			// End of field
			values.push(currentValue);
			currentValue = '';
			startOfField = true;
		}
		else {
			// Regular character or comma inside quotes
			if (char !== ' ' || !startOfField || currentValue.length > 0) {
				currentValue += char;
				startOfField = false;
			}
		}
	}

	// Add last value
	values.push(currentValue);

	// Trim all values
	return values.map(v => v.trim());
}

/**
 * Parse a whole file.
 *
 * Without a header row the columns are named Column 1, Column 2 and so on, and
 * the first row is data like any other.
 */
export function parseCSV(content: string, hasHeaderRow: boolean): ParsedCSV {
	const lines = splitCSVLines(content);
	if (lines.length === 0) {
		return { headers: [], rows: [] };
	}

	let headers: string[];
	let startIndex: number;

	if (hasHeaderRow) {
		// First row contains headers
		headers = parseCSVLine(lines[0]);
		startIndex = 1;
	}
	else {
		// No header row - generate column names
		const firstRowValues = parseCSVLine(lines[0]);
		headers = firstRowValues.map((_, index) => `Column ${index + 1}`);
		startIndex = 0;
	}

	const rows: CSVRow[] = [];

	for (let i = startIndex; i < lines.length; i++) {
		const values = parseCSVLine(lines[i]);
		if (values.length === 0) continue; // Skip empty lines

		const row: CSVRow = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j] || '';
		}
		rows.push(row);
	}

	return { headers, rows };
}
