module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint', '@stylistic'],
	extends: ['plugin:@typescript-eslint/recommended'],
	parserOptions: {
		ecmaVersion: 2018,
		sourceType: 'module',
	},
	rules: {
		'@typescript-eslint/interface-name-prefix': 'off',
		'@typescript-eslint/no-unused-vars': ['error', { 'vars': 'all', 'args': 'none', 'caughtErrors': 'none' }],
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/ban-ts-comment': 'off',
		// '@typescript-eslint/no-use-before-define': ['error', { 'functions': false, 'classes': false }],
		'@typescript-eslint/no-empty-function': 'off',
		'@typescript-eslint/no-this-alias': 'off',
		'prefer-rest-params': 'off',
		'prefer-const': 'off',
		'@typescript-eslint/prefer-as-const': 'off',
		'@typescript-eslint/no-unused-expressions': ['error', { 'allowShortCircuit': true, 'allowTernary': true }],
		'@typescript-eslint/no-require-imports': ['error', { 'allow': ['^xml-flow$']}],

		// Syntax
		'@stylistic/comma-dangle': ['error', 'only-multiline'],
		'@stylistic/quotes': ['error', 'single', { 'allowTemplateLiterals': true }],
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
		'@stylistic/indent': ['error', 'tab'],
	},
};
