import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import obsidianmd from 'eslint-plugin-obsidianmd';

// The plugin's recommended config also turns on ~170 general typescript-eslint
// rules, several of which this repo deliberately disables below. Take just the
// Obsidian-specific rules: those are the ones that catch plugin API misuse.
//
// Warnings rather than errors while the older importers are brought in line -
// they still surface in `npm run lint` without failing the build.
const obsidianRules = Object.fromEntries(
	Object.keys(obsidianmd.rules).map(name => [`obsidianmd/${name}`, 'warn'])
);

export default defineConfig(
	// Its own entry so it applies globally. Inside a config object, ignores only
	// scopes that object, and the file still reaches every other one.
	{ ignores: ['src/z-worker-inline.js'] },
	// The community review runs eslint's core rules, so run them here too.
	// Without this, `npm run lint --fix` deletes disable directives as unused
	// that the review then needs, and core findings only surface at review time.
	js.configs.recommended,
	ts.configs.recommended,
	{
		// no-undef only reaches the plain .js files - typescript-eslint turns it
		// off for TypeScript, where the compiler already answers the question.
		files: ['**/*.js'],
		languageOptions: {
			globals: {
				window: 'readonly',
				Buffer: 'readonly',
				console: 'readonly',
			},
		},
	},
	{
		// Several Obsidian rules need type information
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: { obsidianmd },
		rules: {
			...obsidianRules,
			// Sentence case, but the products being imported keep their own casing,
			// and identifiers that appear verbatim in a vault are not prose.
			'obsidianmd/ui/sentence-case': ['warn', {
				// Replaces the plugin's default list rather than extending it, so
				// anything this repo writes has to be named here - including the
				// defaults it still relies on, like Markdown.
				brands: [
					'Airtable', 'Apple', 'Apple Notes', 'Bear', 'Evernote', 'Google', 'Google Keep',
					'Markdown', 'Microsoft', 'Notion', 'Obsidian', 'OneNote', 'Roam',
					'Tomboy', 'iCloud',
				],
				// Not prose: property names written verbatim into a vault, a date
				// format, and quoted button labels the text is telling you to click.
				ignoreRegex: [
					'^base$', '^cover$', '^tags$', 'airtable-id', 'notion-id',
					'^YYYY-MM-DD$', 'Click "Load"', '"TODO"',
				],
				// A unit, not a word
				ignoreWords: ['MB', '(MB)', 'TODO'],
			}],
		},
	},
	{
		plugins: {
			'@typescript-eslint': ts.plugin,
			'@stylistic': stylistic,
		},

		rules: {
			'@typescript-eslint/interface-name-prefix': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { 'vars': 'all', 'args': 'none' }],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			// '@typescript-eslint/no-use-before-define': ['error', { 'functions': false, 'classes': false }],
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-this-alias': 'off',
			'prefer-rest-params': 'off',
			'prefer-const': 'off',
			'@typescript-eslint/prefer-as-const': 'off',
			'@typescript-eslint/no-unused-expressions': ['error', { 'allowShortCircuit': true, 'allowTernary': true }],
			// A promise-returning check that lost its await reads as its own
			// answer: `if (ctx.shouldStop())` tests the promise, which is always
			// truthy, so the import stops while looking like it finished. The
			// community review runs this rule; running it here too is what stops
			// that landing as a review finding instead of a failing lint.
			'@typescript-eslint/no-misused-promises': 'error',

			// Syntax
			'@stylistic/comma-dangle': ['error', 'only-multiline'],
			'@stylistic/quotes': ['error', 'single', { 'allowTemplateLiterals': 'always' }],
			'@stylistic/semi': ['error'],
			'@stylistic/member-delimiter-style': ['error', { 'singleline': { 'delimiter': 'comma' } }],
			'@stylistic/dot-location': ['error', 'property'],

			// Braces
			'curly': ['error', 'multi-line'],
			'@stylistic/object-curly-spacing': ['error', 'always'],
			'@stylistic/brace-style': ['error', 'stroustrup'],

			// Indentation
			'@stylistic/indent': ['error', 'tab', {
				'SwitchCase': 1,
			}],
			'@stylistic/no-tabs': 'off',
		},
	},
);
