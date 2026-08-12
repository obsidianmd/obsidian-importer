import { outsideCodeSpans } from '../../markdown';

const queryStartRe = /\{\{(?:\[\[query\]\]|query)\s*:/i;

const tagRe = /^#[^\s{}[\]()]+/;

export function convertRoamQueries(blockText: string, drop: boolean = false): string {
	return outsideCodeSpans(blockText, segment => rewriteQueries(segment, drop));
}

function rewriteQueries(text: string, drop: boolean): string {
	let result = '';
	let rest = text;

	for (;;) {
		const start = queryStartRe.exec(rest);
		if (!start) return result + rest;

		const opensAt = start.index;
		const closesAt = matchingBrace(rest, opensAt);
		if (closesAt === -1) return result + rest;

		const whole = rest.slice(opensAt, closesAt + 1);
		const named = whole.slice(2, -2);
		const search = drop ? null : translateClause(named.slice(named.indexOf(':') + 1));
		const written = search !== null ? `\`\`\`query\n${search}\n\`\`\`` : drop ? '' : whole;

		result += rest.slice(0, opensAt) + written;
		rest = rest.slice(closesAt + 1);
	}
}

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
		translated.push(`(${nested})`);
	}

	switch (operator.toLowerCase()) {
		case 'and': return translated.join(' ');
		case 'or': return translated.join(' OR ');
		case 'not': return translated.map(term => `-${term}`).join(' ');
	}

	return null;
}

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

function matchingBrace(text: string, from: number): number {
	let depth = 0;

	for (let at = from; at < text.length; at++) {
		if (text[at] === '{') depth++;
		else if (text[at] === '}' && --depth === 0) return at;
	}

	return -1;
}
