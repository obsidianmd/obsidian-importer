/**
 * A setting a script needs, from the environment or from `.env`.
 *
 * The environment wins, so CI passes values in without a file existing at all,
 * and a local run keeps its key in `.env`, which is not committed. Nothing here
 * writes to it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} name
 * @returns {string | undefined}
 */
export function env(name) {
	if (process.env[name]) return process.env[name];

	const file = path.join(repo, '.env');
	if (!fs.existsSync(file)) return undefined;

	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
		if (match?.[1] === name) return match[2].trim().replace(/^["']|["']$/g, '');
	}

	return undefined;
}
