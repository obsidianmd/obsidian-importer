/**
 * Small things a conversion does to markdown text, with nothing behind them.
 */

/**
 * Rewrite everything but what stands inside backticks.
 *
 * A source's own documentation shows its markup as an example in code, and a
 * conversion that rewrote those too would leave the page explaining a syntax
 * in terms of another one - or, where the rewrite opens a fence, make a mess
 * of both the example and the block it sits in.
 */
export function outsideCodeSpans(text: string, rewrite: (segment: string) => string): string {
	// An odd index is a code span, since the pattern is the split's separator.
	return text
		.split(/(`+[^`]*`+)/)
		.map((segment, index) => index % 2 === 1 ? segment : rewrite(segment))
		.join('');
}
