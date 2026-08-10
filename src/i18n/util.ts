/**
 * The parts of localization that are pure data: how a key is spelled, how a
 * bundle is flattened, how a placeholder is filled, and how a translation file
 * is read and written.
 *
 * Nothing here touches the vault, the DOM or Obsidian, so both the runtime
 * lookup and the script that regenerates `locale/*.txt` can import it.
 */

/** Values substituted into `{{placeholder}}` markers. */
export type Vars = Record<string, string | number>;

/** A language's strings, keyed by the kebab-case dotted path. */
export type Bundle = Record<string, string>;

/**
 * `msgValueAtLeast` becomes `msg-value-at-least`, which is how Obsidian spells
 * a key in a translation file. A plural variant keeps its underscore, so
 * `noteWithCount_plural` becomes `note-with-count_plural`.
 */
export function camelToKebab(text: string): string {
	return text.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

/** Collapse the nested English object into the flat map the lookup uses. */
export function flatten(strings: object, prefix: string = ''): Bundle {
	const flat: Bundle = {};

	for (const key of Object.keys(strings)) {
		const value: unknown = (strings as Record<string, unknown>)[key];
		const path = prefix + camelToKebab(key);

		if (typeof value === 'string') flat[path] = value;
		else if (value && typeof value === 'object') Object.assign(flat, flatten(value, path + '.'));
	}

	return flat;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Fill `{{name}}` markers from `vars`. A marker with no value is left as it is
 * rather than blanked, so a translation that invents a placeholder shows what
 * it asked for instead of a hole.
 */
export function interpolate(text: string, vars?: Vars, language?: string): string {
	if (!vars) return text;

	return text.replace(PLACEHOLDER, (marker, name: string) => {
		const value = vars[name];
		if (value === undefined) return marker;

		// The reader chose this language in Obsidian; the machine underneath may
		// be set to another, and it is the chosen one that should group digits.
		return typeof value === 'number' ? value.toLocaleString(language) : value;
	});
}

/**
 * A translation file is line-based, so a string containing a newline has to
 * carry it as an escape.
 */
export function encodeNewlines(text: string): string {
	return text.replace(/[\n\\]/g, c => '\\' + (c === '\n' ? 'n' : '\\'));
}

export function decodeNewlines(text: string): string {
	return text.replace(/\\[n\\]/g, c => c[1] === 'n' ? '\n' : '\\');
}

/**
 * Write the block format used by obsidian-translations: a key in brackets, the
 * English it was written from, and the translation to fill in.
 *
 * `original` is what makes a stale translation visible — when the English
 * changes, the line beneath the key changes with it in the diff.
 */
export function stringifyLocale(english: Bundle, translations: Bundle): string {
	const blocks: string[] = [];

	for (const key of Object.keys(english)) {
		blocks.push(
			`[${key}]\n`
			+ `original=${encodeNewlines(english[key])}\n`
			+ `translation=${encodeNewlines(translations[key] ?? '')}\n`
		);
	}

	return blocks.join('\n');
}

/**
 * Read a translation file back. An untranslated block contributes nothing, so
 * the key falls through to English at runtime rather than resolving to ''.
 *
 * Whitespace at either end is kept: a string that runs into a link or a name
 * after it carries the space between them, and trimming would close the gap.
 * Only the carriage return of a CRLF file is dropped.
 */
export function parseLocale(text: string): Bundle {
	const bundle: Bundle = {};
	let key: string | null = null;

	for (const line of text.split('\n')) {
		const trimmed = line.trim();

		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			key = trimmed.slice(1, -1);
			continue;
		}

		if (key && line.startsWith('translation=')) {
			const value = decodeNewlines(line.slice('translation='.length).replace(/\r$/, ''));
			if (value.trim()) bundle[key] = value;
			key = null;
		}
	}

	return bundle;
}
