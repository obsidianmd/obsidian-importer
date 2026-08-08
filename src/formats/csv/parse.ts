
export interface CSVRow {
	[key: string]: string;
}

export interface ParsedCSV {
	headers: string[];
	rows: CSVRow[];
}

export function splitCSVLines(content: string): string[] {
	const lines: string[] = [];
	let currentLine = '';
	let inQuotes = false;

	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		const nextChar = content[i + 1];

		if (char === '"') {
			currentLine += char;
			if (inQuotes && nextChar === '"') {
				currentLine += '"';
				i++;
			}
			else {
				inQuotes = !inQuotes;
			}
		}
		else if (char === '\n' && !inQuotes) {
			if (currentLine.trim().length > 0) {
				lines.push(currentLine);
			}
			currentLine = '';
		}
		else if (char === '\r' && nextChar === '\n' && !inQuotes) {
			if (currentLine.trim().length > 0) {
				lines.push(currentLine);
			}
			currentLine = '';
			i++;
		}
		else if (char === '\r' && !inQuotes) {
			if (currentLine.trim().length > 0) {
				lines.push(currentLine);
			}
			currentLine = '';
		}
		else {
			currentLine += char;
		}
	}

	if (currentLine.trim().length > 0) {
		lines.push(currentLine);
	}

	return lines;
}

export function parseCSVLine(line: string): string[] {
	const values: string[] = [];
	let currentValue = '';
	let inQuotes = false;
	let startOfField = true;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const nextChar = line[i + 1];

		if (char === '"' && startOfField) {
			inQuotes = true;
			startOfField = false;
		}
		else if (char === '"' && inQuotes) {
			if (nextChar === '"') {
				currentValue += '"';
				i++;
			}
			else {
				inQuotes = false;
			}
		}
		else if (char === ',' && !inQuotes) {
			values.push(currentValue);
			currentValue = '';
			startOfField = true;
		}
		else {
			if (char !== ' ' || !startOfField || currentValue.length > 0) {
				currentValue += char;
				startOfField = false;
			}
		}
	}

	values.push(currentValue);

	return values.map(v => v.trim());
}

export function parseCSV(content: string, hasHeaderRow: boolean): ParsedCSV {
	const lines = splitCSVLines(content);
	if (lines.length === 0) {
		return { headers: [], rows: [] };
	}

	let headers: string[];
	let startIndex: number;

	if (hasHeaderRow) {
		headers = parseCSVLine(lines[0]);
		startIndex = 1;
	}
	else {
		const firstRowValues = parseCSVLine(lines[0]);
		headers = firstRowValues.map((_, index) => `Column ${index + 1}`);
		startIndex = 0;
	}

	const rows: CSVRow[] = [];

	for (let i = startIndex; i < lines.length; i++) {
		const values = parseCSVLine(lines[i]);
		if (values.length === 0) continue;

		const row: CSVRow = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j] || '';
		}
		rows.push(row);
	}

	return { headers, rows };
}
