// Pure helpers for translating Logseq page filenames into vault-relative paths.
//
// Logseq stores namespaced pages as flat files whose name encodes the namespace.
// The default separator for `/` is the triple underscore `___`; some older
// graphs use the percent-encoded `%2F`. Other special characters in titles may
// be percent-encoded too (e.g. `%3A` for `:`).

// Matches one or more consecutive valid percent-escapes. Decoding a whole run
// at once keeps multi-byte UTF-8 sequences (e.g. `%C3%A9`) intact.
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * Percent-decode a Logseq filename body tolerantly: valid escapes are decoded,
 * while malformed sequences (e.g. `%ZZ`, a lone `%2`, a bare `%`) are left
 * unchanged instead of throwing. The `___` namespace separator is untouched.
 */
export function decodeLogseqName(name: string): string {
	return name.replace(PERCENT_RUN, (run) => {
		try {
			return decodeURIComponent(run);
		}
		catch {
			// Valid hex escapes that don't form valid UTF-8: leave as-is.
			return run;
		}
	});
}

/**
 * Convert a Logseq page filename body (without `.md`) into a vault-relative
 * page path (without extension), turning namespace separators into `/`.
 *
 * Splits on `%2F` if present, otherwise on `___`. Single `/` and single `_`
 * are not separators. Each segment is percent-decoded. OS-illegal-character
 * sanitization is intentionally left to the caller.
 */
export function namespaceToPath(filenameBody: string): string {
	const separator = /%2F/i.test(filenameBody) ? /%2F/i : '___';
	return filenameBody
		.split(separator)
		.map(decodeLogseqName)
		.join('/');
}

/**
 * Alias of {@link namespaceToPath}, named for use by the link rewriter when
 * mapping a wikilink target to its on-disk page path.
 */
export function pageNameToPath(filenameBody: string): string {
	return namespaceToPath(filenameBody);
}
