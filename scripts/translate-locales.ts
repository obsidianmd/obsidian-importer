/**
 * Translate one Importer locale with the same terminology sources as
 * obsidian-help.
 *
 *   pnpm translate-locales -- fr
 *   pnpm translate-locales -- fr --from <git-ref>
 *   pnpm translate-locales -- fr --dry-run
 *
 * Existing translations are kept unless their English source changed between
 * --from and the current tree. Missing strings are translated in batches. The
 * locale list comes from obsidian-help and terminology comes from
 * obsidian-translations; their locations can be overridden for CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../src/i18n/en';
import { Bundle, decodeNewlines, flatten, parseLocale, stringifyLocale } from '../src/i18n/util';
import { env } from './env.mjs';
import { sentenceCase } from './sentence-case.mjs';

interface LocaleDefinition {
	code: string;
	english: string;
}

interface MessageResponse {
	content?: Array<{ text?: string }>;
}

interface TranslationResult {
	key: string;
	translation: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const locale = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
const fromIndex = args.indexOf('--from');
const fromRef = fromIndex === -1 ? undefined : args[fromIndex + 1];
const dryRun = args.includes('--dry-run');

if (!locale || (fromIndex !== -1 && !fromRef)) {
	console.error('Usage: pnpm translate-locales -- <locale> [--from <git-ref>] [--dry-run]');
	process.exit(1);
}

const helpRoot = path.resolve(env('OBSIDIAN_HELP_PATH') ?? path.join(root, '..', 'obsidian-help'));
const translationsRoot = path.resolve(
	env('OBSIDIAN_TRANSLATIONS_PATH') ?? path.join(root, '..', 'obsidian-translations')
);
const localeDefinitionsPath = path.join(helpRoot, 'scripts', 'locales.json');

if (!existsSync(localeDefinitionsPath)) {
	throw new Error(`Could not find obsidian-help locale definitions at ${localeDefinitionsPath}`);
}

if (!existsSync(path.join(translationsRoot, 'terms.txt'))) {
	throw new Error(`Could not find obsidian-translations at ${translationsRoot}`);
}

const localeDefinitions = JSON.parse(readFileSync(localeDefinitionsPath, 'utf8')) as LocaleDefinition[];
const definition = localeDefinitions.find(candidate => candidate.code === locale);
if (!definition || locale === 'en') {
	throw new Error(`${locale} is not a translated locale in obsidian-help`);
}

const english = flatten(en);
const localePath = path.join(root, 'locale', `${locale}.txt`);
const existingText = existsSync(localePath) ? readFileSync(localePath, 'utf8') : '';
const existing = parseLocale(existingText);

/** Read original= values from the editable Obsidian translation format. */
function parseOriginals(text: string): Bundle {
	const originals: Bundle = {};
	let key: string | undefined;

	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			key = trimmed.slice(1, -1);
		}
		else if (key && line.startsWith('original=')) {
			originals[key] = decodeNewlines(line.slice('original='.length).replace(/\r$/, ''));
		}
	}

	return originals;
}

const recordedOriginals = parseOriginals(existingText);

/**
 * The English as it stood at `ref`, which is what makes a stale translation
 * visible: regenerating rewrites the `original=` line in the same commit that
 * changed the string, so the file alone no longer says which ones moved.
 *
 * A ref that predates the file, or one that no longer resolves after a force
 * push, is not worth failing a whole locale over — the keys that are simply
 * missing are still found without it.
 */
function englishAtRef(ref: string): Bundle | undefined {
	try {
		const text = execFileSync('git', ['show', `${ref}:locale/en.txt`], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return parseOriginals(text);
	}
	catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.warn(`${locale}: could not read locale/en.txt at ${ref}, translating only what is missing: ${detail}`);
		return undefined;
	}
}

const previousEnglish = fromRef ? englishAtRef(fromRef) : undefined;
const needsTranslation = Object.keys(english).filter(key =>
	existing[key] === undefined
	|| recordedOriginals[key] !== english[key]
	|| (previousEnglish !== undefined && previousEnglish[key] !== english[key])
);

/** Help uses km, while obsidian-translations still names the Khmer table kh. */
const glossaryLocale = locale === 'km' ? 'kh' : locale;

interface Glossary {
	exact: Map<string, string>;
	terms: Map<string, string>;
}

function normalized(text: string): string {
	return text.trim().toLocaleLowerCase('en');
}

/**
 * Words Obsidian and the app being imported from both use, for different
 * things. An Airtable base is not an Obsidian Base, so the app's word for one
 * is confidently wrong in every string the Airtable importer shows — and wrong
 * in a way a reviewer who has not used Airtable would not catch.
 */
const MEANS_SOMETHING_ELSE_HERE = new Set(['base', 'bases']);

function loadGlossary(): Glossary {
	const exact = new Map<string, string>();
	const terms = new Map<string, string>();
	const termsText = readFileSync(path.join(translationsRoot, 'terms.txt'), 'utf8');
	let section = '';

	for (const line of termsText.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			section = trimmed.slice(1, -1);
			continue;
		}

		if (section !== glossaryLocale) continue;
		const equals = trimmed.indexOf('=');
		if (equals === -1) continue;
		const source = trimmed.slice(0, equals);
		const translation = trimmed.slice(equals + 1);
		if (!source || !translation) continue;
		const key = normalized(source);
		if (MEANS_SOMETHING_ELSE_HERE.has(key)) continue;
		terms.set(key, translation);
		exact.set(key, translation);
	}

	// Obsidian's own string table, in this language. A whole string that matches
	// one is already answered; a short one is the app's word for something the
	// importer talks about too, and reads better than a fresh invention of it.
	// A long one is a sentence, and matches nothing worth borrowing.
	const appTranslationPath = path.join(translationsRoot, 'translations', `${glossaryLocale}.txt`);
	if (existsSync(appTranslationPath)) {
		let source = '';
		for (const line of readFileSync(appTranslationPath, 'utf8').split('\n')) {
			if (line.startsWith('original=')) source = line.slice('original='.length);
			else if (line.startsWith('translation=') && source) {
				const translation = line.slice('translation='.length);
				if (translation.trim()) {
					const key = normalized(source);
					if (MEANS_SOMETHING_ELSE_HERE.has(key)) { source = ''; continue; }
					exact.set(key, translation);
					// terms.txt is curated and carries descriptions, so it wins.
					if (!terms.has(key) && key.length > 2 && key.split(/\s+/).length <= 3
						// A string that is only a placeholder translates to itself.
						&& /[a-z]/.test(key.replace(/\{\{\w+\}\}/g, ''))) {
						terms.set(key, translation);
					}
				}
				source = '';
			}
		}
	}

	return { exact, terms };
}

function edges(text: string): [string, string] {
	return [/^\s*/.exec(text)?.[0] ?? '', /\s*$/.exec(text)?.[0] ?? ''];
}

function preserveEdges(source: string, translated: string): string {
	const [leading, trailing] = edges(source);
	return leading + translated.trim() + trailing;
}

function placeholders(text: string): string[] {
	return (text.match(/\{\{\w+\}\}/g) ?? []).sort();
}

function validateTranslation(key: string, translated: string): string {
	const value = preserveEdges(english[key], translated);
	if (!value.trim()) throw new Error(`${key} was translated to an empty string`);
	if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(english[key]))) {
		throw new Error(`${key} changed its placeholders`);
	}
	return value;
}

const glossary = loadGlossary();
const translated: Bundle = { ...existing };
const remaining: string[] = [];
let exactMatches = 0;

for (const key of needsTranslation) {
	const match = glossary.exact.get(normalized(english[key]));
	if (match !== undefined) {
		translated[key] = validateTranslation(key, match);
		exactMatches++;
	}
	else {
		remaining.push(key);
	}
}

console.log(
	`${locale}: ${Object.keys(existing).length}/${Object.keys(english).length} present; `
	+ `${needsTranslation.length} need translation; ${exactMatches} exact glossary matches; `
	+ `${remaining.length} need the language model`
);

if (dryRun) process.exit(0);

const apiKey = env('ANTHROPIC_API_KEY');
const endpoint = env('LLM_API_ENDPOINT') ?? 'https://api.anthropic.com/v1/messages';
const model = env('LLM_MODEL') ?? 'claude-opus-4-6';

if (remaining.length > 0 && !apiKey) {
	throw new Error('Set ANTHROPIC_API_KEY, in the environment or in .env, to translate strings not found in the glossary');
}

function batches(keys: string[]): string[][] {
	const result: string[][] = [];
	let batch: string[] = [];
	let characters = 0;

	for (const key of keys) {
		const size = key.length + english[key].length;
		if (batch.length >= 40 || (characters + size > 8000 && batch.length > 0)) {
			result.push(batch);
			batch = [];
			characters = 0;
		}
		batch.push(key);
		characters += size;
	}

	if (batch.length > 0) result.push(batch);
	return result;
}

/**
 * The glossary is filtered to the batch, and on whole words: as a substring,
 * `pan` is in "expand" and `all` is in "install", which spends the prompt on
 * terms the batch never mentions.
 */
function relevantTerms(keys: string[]): string {
	const source = keys.map(key => english[key]).join('\n').toLocaleLowerCase('en');
	return [...glossary.terms]
		.filter(([term]) => new RegExp(`(?<![a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(source))
		.map(([term, translation]) => `${term} = ${translation}`)
		.join('\n');
}

function parseResponse(text: string): TranslationResult[] {
	const start = text.indexOf('[');
	const end = text.lastIndexOf(']');
	if (start === -1 || end === -1) throw new Error('The language model did not return a JSON array');
	const value: unknown = JSON.parse(text.slice(start, end + 1));
	if (!Array.isArray(value)) throw new Error('The language model response was not an array');
	return value as TranslationResult[];
}

const languageNote: Record<string, string> = {
	de: 'Use informal du, matching the Obsidian website; never use formal Sie.',
	ko: 'Use calm, practical 해요체 product-documentation style, not 합니다체.',
};

async function translateBatch(keys: string[]): Promise<void> {
	const request = keys.map(key => ({ key, source: english[key] }));
	const terms = relevantTerms(keys);
	const system = `You are a professional translator for the Obsidian Importer plugin. Translate UI strings into ${definition.english}.

Rules:
1. Return only a JSON array of objects with exactly the input keys and a "translation" string.
2. Preserve every {{placeholder}} exactly, including its spelling. You may move it.
3. Preserve leading and trailing whitespace, escaped newlines, and punctuation that is part of a value.
4. Write these names exactly as they appear, whatever the surrounding language: ${sentenceCase.brands.join(', ')}.
5. Leave these unchanged as well; they are units, date parts, or format names: ${sentenceCase.acronyms.join(', ')}.
6. A name in quotes is a property written into the reader's notes, not text on screen. Leave what is inside the quotes exactly as it is.
7. Translate singular and plural entries appropriately. The _plural key is the general form for every count other than one.
8. Prefer concise, natural product UI language.
${languageNote[locale] ?? ''}
${terms ? `\nObsidian itself is already translated into ${definition.english}, and the importer opens inside it. Where one of these words appears, use the app's wording rather than a synonym:\n${terms}` : ''}`;

	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey!,
					'anthropic-version': '2023-06-01',
				},
				body: JSON.stringify({
					model,
					max_tokens: 8192,
					system,
					messages: [{ role: 'user', content: JSON.stringify(request) }],
				}),
			});

			if (!response.ok) throw new Error(`LLM API error ${response.status}: ${await response.text()}`);
			const body = await response.json() as MessageResponse;
			const results = parseResponse((body.content ?? []).map(block => block.text ?? '').join(''));
			const byKey = new Map(results.map(result => [result.key, result.translation]));

			for (const key of keys) {
				const value = byKey.get(key);
				if (typeof value !== 'string') throw new Error(`The language model omitted ${key}`);
				translated[key] = validateTranslation(key, value);
			}
			return;
		}
		catch (error) {
			lastError = error;
			console.warn(`${locale}: batch attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
			if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
		}
	}

	throw lastError;
}

/**
 * A singular with no plural beside it means a count in this language and a
 * count in English can meet in one sentence, which the test suite refuses. A
 * batch that fails can leave half a pair behind, so hold back whichever half
 * arrived — the key it came from is still waiting in `translated`, and the
 * other half landing later completes the pair.
 */
function paired(bundle: Bundle): Bundle {
	const result: Bundle = { ...bundle };

	for (const key of Object.keys(english)) {
		if (!key.endsWith('_plural')) continue;
		const singular = key.slice(0, -'_plural'.length);
		if (english[singular] === undefined) continue;
		if ((result[key] === undefined) === (result[singular] === undefined)) continue;
		delete result[key];
		delete result[singular];
	}

	return result;
}

function write(): void {
	writeFileSync(localePath, stringifyLocale(english, paired(translated)));
}

async function main(): Promise<void> {
	const work = batches(remaining);
	let failed = 0;

	for (let index = 0; index < work.length; index++) {
		console.log(`${locale}: translating batch ${index + 1}/${work.length} (${work[index].length} strings)`);

		try {
			await translateBatch(work[index]);
		}
		catch (error) {
			// One batch is not worth the twelve before it. The keys it covered
			// stay untranslated, so they fall back to English and the next run
			// finds them missing and asks again.
			failed++;
			console.warn(`${locale}: gave up on batch ${index + 1}: ${error instanceof Error ? error.message : error}`);
			continue;
		}

		write();
	}

	if (failed > 0 && failed === work.length) {
		throw new Error(`${locale}: every batch failed`);
	}

	write();
	console.log(`Wrote ${path.relative(root, localePath)}${failed ? `, ${failed} batches short` : ''}`);
}

void main().catch(error => {
	console.error(error);
	process.exit(1);
});
