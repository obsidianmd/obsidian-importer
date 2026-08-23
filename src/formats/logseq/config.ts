export type LogseqFilenameFormat = 'triple-lowbar' | 'legacy';

export interface LogseqGraphConfig {
	pagesDirectory: string;
	journalsDirectory: string;
	whiteboardsDirectory: string;
	filenameFormat: LogseqFilenameFormat;
	journalFileNameFormat?: string;
	journalPageTitleFormat?: string;
	commaSeparatedProperties: Set<string>;
}

interface EdnToken {
	kind: 'atom' | 'string' | 'open' | 'close';
	value: string;
	depth: number;
}

function readString(input: string, start: number): { value: string, end: number } {
	let value = '';
	let i = start + 1;
	while (i < input.length) {
		const ch = input[i++];
		if (ch === '"') return { value, end: i };
		if (ch !== '\\') {
			value += ch;
			continue;
		}
		if (i >= input.length) break;
		const escaped = input[i++];
		const simple: Record<string, string> = {
			b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\',
		};
		if (escaped === 'u' && /^[0-9A-Fa-f]{4}$/.test(input.slice(i, i + 4))) {
			value += String.fromCharCode(parseInt(input.slice(i, i + 4), 16));
			i += 4;
		}
		else {
			value += simple[escaped] ?? escaped;
		}
	}
	return { value, end: i };
}

function tokenize(input: string): EdnToken[] {
	const tokens: EdnToken[] = [];
	const stack: string[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (/\s|,/.test(ch)) {
			i++;
			continue;
		}
		if (ch === ';') {
			while (i < input.length && input[i] !== '\n') i++;
			continue;
		}
		if (ch === '"') {
			const string = readString(input, i);
			tokens.push({ kind: 'string', value: string.value, depth: stack.length });
			i = string.end;
			continue;
		}
		if ('{[('.includes(ch)) {
			tokens.push({ kind: 'open', value: ch, depth: stack.length });
			stack.push(ch);
			i++;
			continue;
		}
		if ('}])'.includes(ch)) {
			stack.pop();
			tokens.push({ kind: 'close', value: ch, depth: stack.length });
			i++;
			continue;
		}
		const start = i;
		while (i < input.length && !(/\s/.test(input[i]) || ',;{}[]()"'.includes(input[i]))) i++;
		tokens.push({ kind: 'atom', value: input.slice(start, i), depth: stack.length });
	}
	return tokens;
}

function topLevelValue(tokens: EdnToken[], key: string): { token: EdnToken, index: number } | null {
	const index = tokens.findIndex(token =>
		token.depth === 1 && token.kind === 'atom' && token.value === `:${key}`);
	if (index < 0 || index + 1 >= tokens.length) return null;
	return { token: tokens[index + 1], index: index + 1 };
}

function scalar(tokens: EdnToken[], key: string): string | undefined {
	const found = topLevelValue(tokens, key)?.token;
	if (!found || (found.kind !== 'string' && found.kind !== 'atom')) return undefined;
	return found.kind === 'atom' ? found.value.replace(/^:/, '') : found.value;
}

function collection(tokens: EdnToken[], key: string): string[] {
	let found = topLevelValue(tokens, key);
	if (found?.token.kind === 'atom' && found.token.value === '#') {
		const next = tokens[found.index + 1];
		if (next?.kind === 'open' && next.value === '{') {
			found = { token: next, index: found.index + 1 };
		}
	}
	if (!found || found.token.kind !== 'open' || !'[{'.includes(found.token.value)) return [];
	const values: string[] = [];
	for (let i = found.index + 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.kind === 'close' && token.depth === found.token.depth) break;
		if (token.depth !== found.token.depth + 1) continue;
		if (token.kind === 'string') values.push(token.value);
		else if (token.kind === 'atom' && token.value.startsWith(':')) values.push(token.value.slice(1));
	}
	return values;
}

function directory(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const parts = value.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
	if (parts.length === 0 || parts.includes('..')) return fallback;
	return parts.join('/');
}

export function parseLogseqConfig(content: string): LogseqGraphConfig {
	const tokens = tokenize(content);
	const rawFilenameFormat = scalar(tokens, 'file/name-format');
	return {
		pagesDirectory: directory(scalar(tokens, 'pages-directory'), 'pages'),
		journalsDirectory: directory(scalar(tokens, 'journals-directory'), 'journals'),
		whiteboardsDirectory: directory(scalar(tokens, 'whiteboards-directory'), 'whiteboards'),
		filenameFormat: rawFilenameFormat === 'triple-lowbar' ? 'triple-lowbar' : 'legacy',
		journalFileNameFormat: scalar(tokens, 'journal/file-name-format'),
		journalPageTitleFormat: scalar(tokens, 'journal/page-title-format'),
		commaSeparatedProperties: new Set(collection(tokens, 'property/separated-by-commas')
			.map(property => property.toLowerCase())),
	};
}

export function defaultLogseqConfig(): LogseqGraphConfig {
	return { ...parseLogseqConfig(''), filenameFormat: 'triple-lowbar' };
}
