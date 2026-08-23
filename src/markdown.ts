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

/**
 * Splits Markdown into ordinary text and code, retaining every delimiter.
 * Fenced blocks and inline code spans are both protected. The fence matcher
 * accepts backticks, tildes, and list-prefixed fences produced by outliners.
 */
function codeSegments(text: string): MarkdownCodeSegment[] {
	const fenced: MarkdownCodeSegment[] = [];
	let fence: { marker: string, length: number } | null = null;

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
			const close = /^[ \t]*(?:[-*+]\s+)?([`~]{3,})[ \t]*(?:\n|$)/.exec(line);
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
