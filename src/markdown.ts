export function outsideCodeSpans(text: string, rewrite: (segment: string) => string): string {
	return text
		.split(/(`+[^`]*`+)/)
		.map((segment, index) => index % 2 === 1 ? segment : rewrite(segment))
		.join('');
}

interface MarkdownCodeSegment {
	code: boolean;
	text: string;
}

/** Marks lines that belong to a fenced code block, including both delimiters. */
export function markdownFenceLines(text: string): boolean[] {
	const protectedLines: boolean[] = [];
	let fence: { marker: string, length: number } | null = null;

	// A fence needs one of these; most notes have neither, and this scan runs
	// once per rewriting pass.
	if (!text.includes('`') && !text.includes('~')) return new Array<boolean>(text.split('\n').length).fill(false);

	for (const line of text.split('\n')) {
		if (fence) {
			protectedLines.push(true);
			const close = /^[ \t]*(?:[-*+]\s+)?([`~]{3,})(?:[ \t]+\^[A-Za-z0-9_-]+)?[ \t]*$/.exec(line);
			if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
			continue;
		}

		const open = /^[ \t]*(?:[-*+]\s+)?([`~]{3,})/.exec(line);
		protectedLines.push(open !== null);
		if (open) {
			const marker = open[1];
			const after = line.slice(open[0].length);
			if (!after.includes(marker)) fence = { marker: marker[0], length: marker.length };
		}
	}

	return protectedLines;
}

/** Rewrites complete non-fenced lines; use outsideMarkdownCode for character-level transforms. */
export function outsideMarkdownFences(text: string, rewrite: (segment: string) => string): string {
	const lines = text.split('\n');
	const fenced = markdownFenceLines(text);
	let written = '';
	let start = 0;

	while (start < lines.length) {
		const isFenced = fenced[start];
		let end = start + 1;
		while (end < lines.length && fenced[end] === isFenced) end++;

		// Give the newline at a run boundary to the preceding run. A transform
		// that deletes its final line can then delete that line's newline too.
		const segment = lines.slice(start, end).join('\n') + (end < lines.length ? '\n' : '');
		written += isFenced ? segment : rewrite(segment);
		start = end;
	}

	return written;
}

/** Splits prose from inline, backtick-fenced, tilde-fenced, and list-fenced code. */
function codeSegments(text: string): MarkdownCodeSegment[] {
	const fenced: MarkdownCodeSegment[] = [];
	let fence: { marker: string, length: number } | null = null;

	// Both fenced and inline code need a backtick or tilde.
	if (!text.includes('`') && !text.includes('~')) return text ? [{ code: false, text }] : [];

	const append = (code: boolean, value: string) => {
		if (!value) return;
		const previous = fenced.at(-1);
		if (previous?.code === code) previous.text += value;
		else fenced.push({ code, text: value });
	};

	for (const line of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
		if (!line) continue;

		if (fence) {
			append(true, line);
			const close = /^[ \t]*(?:[-*+]\s+)?([`~]{3,})(?:[ \t]+\^[A-Za-z0-9_-]+)?[ \t]*(?:\n|$)/.exec(line);
			if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
			continue;
		}

		const open = /^[ \t]*(?:[-*+]\s+)?([`~]{3,})/.exec(line);
		if (!open) {
			append(false, line);
			continue;
		}

		append(true, line);
		const marker = open[1];
		const after = line.slice(open[0].length);
		if (!after.includes(marker)) fence = { marker: marker[0], length: marker.length };
	}

	const segments: MarkdownCodeSegment[] = [];
	for (const segment of fenced) {
		if (segment.code) {
			segments.push(segment);
			continue;
		}

		const pieces = segment.text.split(/(`+[^`]*`+)/);
		for (let index = 0; index < pieces.length; index++) {
			const value = pieces[index];
			if (!value) continue;
			segments.push({ code: index % 2 === 1, text: value });
		}
	}

	return segments;
}

/** Rewrites Markdown prose without changing inline or fenced code. */
export function outsideMarkdownCode(text: string, rewrite: (segment: string) => string): string {
	return codeSegments(text)
		.map(segment => segment.code ? segment.text : rewrite(segment.text))
		.join('');
}

/** Async variant for rewrites such as attachment downloads. */
export async function outsideMarkdownCodeAsync(
	text: string,
	rewrite: (segment: string) => Promise<string>,
): Promise<string> {
	const written: string[] = [];
	for (const segment of codeSegments(text)) {
		written.push(segment.code ? segment.text : await rewrite(segment.text));
	}
	return written.join('');
}

/** The next line with something on it, without copying the rest of the array. */
export function nextNonBlankLine(lines: string[], from: number): string | undefined {
	for (let i = from; i < lines.length; i++) {
		if (lines[i].trim() !== '') return lines[i];
	}
	return undefined;
}
