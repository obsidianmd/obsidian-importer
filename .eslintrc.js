module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	extends: ['plugin:@typescript-eslint/recommended'],
	parserOptions: {
		ecmaVersion: 2018,
		sourceType: 'module',
	},
	rules: {
		'@typescript-eslint/interface-name-prefix': 'off',
		'@typescript-eslint/no-unused-vars': ['error', { 'vars': 'all', 'args': 'none' }],
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/ban-ts-comment': 'off',
		// '@typescript-eslint/no-use-before-define': ['error', { 'functions': false, 'classes': false }],
		'@typescript-eslint/no-empty-function': 'off',
		'@typescript-eslint/ban-types': 'off',
		'@typescript-eslint/no-this-alias': 'off',
		'prefer-rest-params': 'off',
		'prefer-const': 'off',
		'@typescript-eslint/prefer-as-const': 'off',

		// Syntax
		'comma-dangle': ['error', 'only-multiline'],
		'@typescript-eslint/quotes': ['error', 'single', { 'allowTemplateLiterals': true }],
		'@typescript-eslint/semi': ['error'],
		'@typescript-eslint/member-delimiter-style': ['error', { 'singleline': { 'delimiter': 'comma' } }],
		'dot-location': ['error', 'property'],

		// Braces
		'curly': ['error', 'multi-line'],
		'object-curly-spacing': ['error', 'always'],
		'brace-style': ['error', 'stroustrup'],

		// Indentation
		// NOTE: The typescript indent rule is broken and we may need to disable
		// it and switch to a different formatter.
		// https://github.com/typescript-eslint/typescript-eslint/issues/1824
		'indent': ['error', 'tab', {
			'SwitchCase': 1,
		}],
		'no-tabs': 'off',
		'@typescript-eslint/indent': ['error', 'tab'],
	},
};
