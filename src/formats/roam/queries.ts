/**
 * Roam queries, as Obsidian searches.
 *
 * `{{query: {and: [[A]] [[B]]}}}` asks Roam for the blocks referring to both
 * pages. Obsidian asks the same thing with `block:([[A]] [[B]])` in a `query`
 * code block, which embeds the results in the note - so the two say the same
 * thing and a query survives the import as a query rather than as the text of
 * one.
 *
 * The importer used to delete queries outright, which lost them without saying
 * so. What cannot be translated is now left as Roam wrote it: `{between:}` has
 * no counterpart, and a half-translated query would be worse than a legible
 * one that has to be rewritten by hand.
 */

/** `{{query: …}}` and `{{[[query]]: …}}`, which are the two spellings Roam writes. */
const queryStartRe = /\{\{(?:\[\[query\]\]|query)\s*:/i;

/** What a term can be: a page, a block, or a tag. Anything else is not translated. */
const tagRe = /^#[^\s{}[\]()]+/;

/**
 * Every Roam query in a block, rewritten as a `query` code block.
 *
 * Text inside backticks is left alone: Roam's own help pages show query syntax
 * as an example in code, and a fence opened inside a code span makes a mess of
 * both.
 */
export function convertRoamQueries(blockText: string, drop: boolean = false): string {
	return blockText
		.split(/(`+[^`]*`+)/)
		.map((segment, index) => index % 2 === 1 ? segment : rewriteQueries(segment, drop))
		.join('');
}

function rewriteQueries(text: string, drop: boolean): string {
	let result = '';
	let rest = text;

	for (;;) {
		const start = queryStartRe.exec(rest);
		if (!start) return result + rest;

		// The query begins at the `{{` the match opens with, and ends where
		// that brace is closed - counted rather than searched for, since the
		// clause inside brings braces of its own.
		const opensAt = start.index;
		const closesAt = matchingBrace(rest, opensAt);
		if (closesAt === -1) return result + rest;

		const whole = rest.slice(opensAt, closesAt + 1);
		// `{{query: <clause>}}` - without the braces at either end and the
		// keyword up to its colon, what is left is the clause.
		const named = whole.slice(2, -2);
		const search = drop ? null : translateClause(named.slice(named.indexOf(':') + 1));
		// A query that cannot be translated is left as Roam wrote it, unless the
		// reader asked for queries to go, in which case it goes with the rest.
		const written = search !== null ? `\`\`\`query\n${search}\n\`\`\`` : drop ? '' : whole;

		result += rest.slice(0, opensAt) + written;
		rest = rest.slice(closesAt + 1);
	}
}

/**
 * A whole query clause as a search, or nothing when any part of it says
 * something Obsidian's search cannot - `{between:}`, or a term that is not a
 * page, a block or a tag.
 */
function translateClause(clause: string): string | null {
	const translated = translateGroup(clause.trim());

	return translated === null ? null : `block:(${translated})`;
}

function translateGroup(group: string): string | null {
	const opened = /^\{\s*(and|or|not)\s*:([\s\S]*)\}$/i.exec(group.trim());
	if (!opened) return null;

	const [, operator, body] = opened;
	const terms = splitTerms(body);
	if (terms === null || terms.length === 0) return null;

	const translated: string[] = [];
	for (const term of terms) {
		if (!term.startsWith('{')) {
			translated.push(term);
			continue;
		}

		const nested = translateGroup(term);
		if (nested === null) return null;
		// Parenthesised, so that an `or` nested in an `and` keeps its meaning.
		translated.push(`(${nested})`);
	}

	switch (operator.toLowerCase()) {
		case 'and': return translated.join(' ');
		case 'or': return translated.join(' OR ');
		case 'not': return translated.map(term => `-${term}`).join(' ');
	}

	return null;
}

/** The terms of a clause, or nothing if one of them is not a shape we translate. */
function splitTerms(body: string): string[] | null {
	const terms: string[] = [];
	let at = 0;

	while (at < body.length) {
		const character = body[at];

		if (/\s/.test(character)) {
			at++;
			continue;
		}

		if (character === '{') {
			const closes = matchingBrace(body, at);
			if (closes === -1) return null;

			terms.push(body.slice(at, closes + 1));
			at = closes + 1;
			continue;
		}

		const pair = body.startsWith('[[', at) ? ']]' : body.startsWith('((', at) ? '))' : null;
		if (pair) {
			const closes = body.indexOf(pair, at);
			if (closes === -1) return null;

			terms.push(body.slice(at, closes + 2));
			at = closes + 2;
			continue;
		}

		const tag = tagRe.exec(body.slice(at));
		if (!tag) return null;

		terms.push(tag[0]);
		at += tag[0].length;
	}

	return terms;
}

/** Where the brace opened at `from` is closed, or -1 if it never is. */
function matchingBrace(text: string, from: number): number {
	let depth = 0;

	for (let at = from; at < text.length; at++) {
		if (text[at] === '{') depth++;
		else if (text[at] === '}' && --depth === 0) return at;
	}

	return -1;
}
