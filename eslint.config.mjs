import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { sentenceCase } from './scripts/sentence-case.mjs';

// Enable Obsidian-specific rules without the plugin's broader TypeScript preset.
const obsidianRules = Object.fromEntries(
	Object.keys(obsidianmd.rules).map(name => [`obsidianmd/${name}`, 'warn'])
);

export default defineConfig(
	// A top-level entry keeps this file out of every config below.
	{ ignores: ['src/z-worker-inline.js'] },
	js.configs.recommended,
	ts.configs.recommended,
	{
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
			'obsidianmd/ui/sentence-case': ['warn', sentenceCase],
			// Same rule, applied to src/i18n/en.ts now that the UI text lives there.
			'obsidianmd/ui/sentence-case-locale-module': ['warn', sentenceCase],
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
