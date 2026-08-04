/*
 * The config the Obsidian community plugin review runs: the plugin's full
 * recommended set, which layers ~170 general typescript-eslint rules on top of
 * the Obsidian ones. Kept separate from eslint.config.mjs so `npm run lint`
 * stays fast and focused, while `npm run lint:review` shows what reviewers see.
 */
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig(
	{ ignores: ['src/z-worker-inline.js'] },
	obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
);
