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
// Silence Node's warning for the sqlite fixture helper.
const result = spawnSync(tsx, ['--disable-warning=ExperimentalWarning', '--tsconfig', 'tsconfig.test.json', '--test', ...patterns], {
	cwd: root,
	stdio: 'inherit',
	// A date a conversion writes is formatted in local time, so a recording made
	// in one zone would differ by a day when read in another. The zone is fixed
	// here rather than in each test, since Node reads it once at startup.
	env: { ...process.env, TZ: 'UTC' },
});

process.exit(result.status ?? 1);
