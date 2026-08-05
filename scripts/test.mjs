/**
 * Run the tests, optionally for one importer.
 *
 *   npm test              every test
 *   npm test -- notion    just tests/notion
 *   npm test -- notion html
 *
 * A filter is a directory under tests/, which is one importer, so iterating on
 * one does not wait for the rest.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filters = process.argv.slice(2);

const patterns = filters.length === 0
	? ['tests/**/*.test.ts']
	: filters.map(filter => {
		const dir = filter.replace(/^tests\//, '').replace(/\/$/, '');
		if (!existsSync(path.join(root, 'tests', dir))) {
			console.error(`No tests/${dir}. Available: ${availableSuites().join(', ')}`);
			process.exit(1);
		}
		return `tests/${dir}/**/*.test.ts`;
	});

function availableSuites() {
	return readdirSync(path.join(root, 'tests'), { withFileTypes: true })
		.filter(entry => entry.isDirectory() && entry.name !== 'shims')
		.map(entry => entry.name);
}

const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
// node:sqlite, which a fixture builds a notes database with, is still flagged
// experimental and says so on every run
const result = spawnSync(tsx, ['--disable-warning=ExperimentalWarning', '--tsconfig', 'tsconfig.test.json', '--test', ...patterns], {
	cwd: root,
	stdio: 'inherit',
});

process.exit(result.status ?? 1);
