export function outsideCodeSpans(text: string, rewrite: (segment: string) => string): string {
	return text
		.split(/(`+[^`]*`+)/)
		.map((segment, index) => index % 2 === 1 ? segment : rewrite(segment))
		.join('');
}
