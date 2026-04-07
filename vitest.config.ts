import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		setupFiles: ['src/__tests__/setup.ts'],
	},
	resolve: {
		alias: {
			obsidian: new URL('src/__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
});
