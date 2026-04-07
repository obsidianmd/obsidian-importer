import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/z-worker-inline.js', 'src/formats/**'],
		},
	},
	resolve: {
		alias: {
			'obsidian': new URL('./__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
});
