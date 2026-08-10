import { en } from './en';
import { locales } from './locales';
import { Bundle, camelToKebab, flatten, interpolate, Vars } from './util';

export type { Vars } from './util';

/** The shape of the string table. Every locale is checked against it. */
export type Strings = typeof en;

const ENGLISH: Bundle = flatten(en);

let current: Bundle = ENGLISH;

/**
 * Point the lookup at an app language, falling back to the base language of a
 * regional code and then to English.
 *
 * Called once from onload() with Obsidian's `getLanguage()`. Left alone, the
 * plugin stays in English, which is what a conversion running under test wants.
 */
export function setLanguage(language: string): void {
	current = locales[language]
		?? locales[language.split('-')[0]]
		?? ENGLISH;
}

/** Which languages this build carries, English included. */
export function availableLanguages(): string[] {
	return ['en', ...Object.keys(locales)];
}

/**
 * A count of anything but one takes the `_plural` variant, matching what
 * Obsidian's own translation files offer translators. Languages with more than
 * two plural forms therefore round to the nearer of the two.
 */
function pick(bundle: Bundle, key: string, vars?: Vars): string | undefined {
	if (vars && typeof vars.count === 'number' && vars.count !== 1) {
		const plural = bundle[key + '_plural'];
		if (plural !== undefined) return plural;
	}

	return bundle[key];
}

/**
 * A key missing from the active language falls back to English as a whole
 * rather than per plural form, so a half-translated string never arrives in two
 * languages at once. A key missing from English too returns the key itself,
 * which is visible in the UI and traceable to the line that asked for it.
 */
function translate(key: string, vars?: Vars): string {
	const text = (current !== ENGLISH ? pick(current, key, vars) : undefined)
		?? pick(ENGLISH, key, vars);

	if (text === undefined) return key;

	return interpolate(text, vars);
}

export type Getter = (vars?: Vars) => string;

export type Lookup = (key: string, vars?: Vars) => string;

type Accessor<K> = {
	[key in keyof K]: K[key] extends string ? Getter : Lookup & Accessor<K[key]>;
};

/**
 * Reach a string by the path it has in `en.ts`: `i18n.modal.buttonImport()`.
 *
 * Every node is callable as well as walkable, so a key only known at runtime
 * can be reached from its section: `i18n.importer(id + '.name')`.
 */
function createAccessor(lookup: Lookup): Accessor<Strings> & Lookup {
	function node(prefix: string): unknown {
		const reached: Record<string, unknown> = {};

		const call = (keyOrVars?: string | Vars, vars?: Vars): string => {
			if (typeof keyOrVars === 'string') return lookup(prefix + keyOrVars, vars);
			return prefix ? lookup(prefix.slice(0, -1), keyOrVars) : '';
		};

		return new Proxy(call, {
			get(target, key): unknown {
				if (typeof key === 'symbol') return undefined;
				if (Object.prototype.hasOwnProperty.call(reached, key)) return reached[key];

				return reached[key] = node(prefix + camelToKebab(key) + '.');
			},
		});
	}

	// The proxy answers to every path in the table, which no signature can say.
	return node('') as Accessor<Strings> & Lookup;
}

export const i18n = createAccessor(translate);
