import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.ts'],
	},
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, 'tests/obsidian-mock.ts'),
			zip: '@zip.js/zip.js',
		},
	},
});
