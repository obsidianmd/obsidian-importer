import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Removed after each run.
const FOLDER = '_e2e-check';

const CASES = [
	{ importer: 'html', fixture: 'tests/html/links.html', expected: 'tests/html/expected/links.md', note: 'links.md' },
	// The table rule was read off the app rather than derived, so this is the
	// case that holds it against the app instead of against the reading.
	{ importer: 'html', fixture: 'tests/html/tables.html', expected: 'tests/html/expected/tables.md', note: 'tables.md' },
	{ importer: 'html', fixture: 'tests/html/special filename#.html', expected: 'tests/html/expected/special filename#.md', note: 'special filename.md' },
	{
		importer: 'tomboy',
		fixture: 'tests/tomboy/2769c249-6cbb-4263-ae03-7c0a5be89ac1.note',
		expected: 'tests/tomboy/expected/2769c249-6cbb-4263-ae03-7c0a5be89ac1/TODO Liste.md',
		note: 'TODO Liste.md',
	},
	{
		importer: 'keep',
		fixture: 'tests/keep/notes/Pinned text note.json',
		expected: 'tests/keep/notes/expected/Pinned text note/Pinned text note.md',
		note: 'Pinned text note.md',
	},
	{
		importer: 'apple-journal',
		fixture: 'tests/journal/entry-complex-metadata.html',
		expected: 'tests/journal/expected/entry-complex-metadata.md',
		note: 'entry-complex-metadata.md',
	},
	{
		// The one importer that writes into a folder of its own, which is what
		// makes it worth running here: nothing creates the notebook's folder
		// until a note goes into it, and Vault will not create a file inside a
		// folder that is not there. A fixture with no attachments, because
		// where those land is the vault's attachment setting rather than
		// anything the recording could know.
		importer: 'evernote',
		fixture: 'tests/evernote/yarle/test-headings.enex',
		expected: 'tests/evernote/yarle/expected/test-headings/test - headings.md',
		note: 'test-headings/test - headings.md',
	},
];

function vaultName() {
	if (process.env.E2E_VAULT) return process.env.E2E_VAULT;

	const parts = (process.env.OBSIDIAN_PATH ?? readEnvFile('OBSIDIAN_PATH') ?? '').split('/').filter(Boolean);
	const i = parts.indexOf('.obsidian');
	return i > 0 ? parts[i - 1] : undefined;
}

function readEnvFile(name) {
	const file = path.join(repo, '.env');
	if (!fs.existsSync(file)) return undefined;

	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
		if (match?.[1] === name) return match[2].trim().replace(/^["']|["']$/g, '');
	}

	return undefined;
}

function evalInObsidian(code) {
	const vault = vaultName();
	// The CLI ignores vault= unless it is the first argument.
	const args = vault ? [`vault=${vault}`, 'eval', `code=${code}`] : ['eval', `code=${code}`];
	const result = spawnSync('obsidian', args, {
		encoding: 'utf8',
		timeout: 120_000,
	});

	if (result.error) throw result.error;

	const out = (result.stdout ?? '').trim();
	if (!out.startsWith('=>')) {
		throw new Error(`obsidian eval failed: ${out || result.stderr}`);
	}

	return out.slice(2).trim();
}

// Obsidian receives this as one argument, so a line comment would hide the rest.
// Recorded converter output excludes importer metadata such as source IDs.
const script = `
(async () => {
	const fs = require('fs');
	const plugin = app.plugins.plugins['obsidian-importer'];
	if (!plugin) return JSON.stringify({ error: 'the importer is not enabled in the active vault (' + app.vault.getName() + ')' });

	const cases = ${JSON.stringify(CASES)};
	const repo = ${JSON.stringify(repo)};
	const folder = ${JSON.stringify(FOLDER)};
	const results = [];

	for (const testCase of cases) {
		const ctx = await plugin.runImport(
			testCase.importer,
			[repo + '/' + testCase.fixture],
			folder,
			importer => { importer.saveSourceId = false; });

		const file = app.vault.getAbstractFileByPath(folder + '/' + testCase.note);
		const produced = file ? await app.vault.read(file) : null;
		const expected = fs.readFileSync(repo + '/' + testCase.expected, 'utf8');

		results.push({
			fixture: testCase.fixture,
			notes: ctx.notes,
			failed: ctx.failed,
			found: !!file,
			matches: produced === expected,
			produced: produced === expected ? undefined : produced,
		});
	}

	const written = app.vault.getAbstractFileByPath(folder);
	if (written) {
		if (app.fileManager.trashFile) await app.fileManager.trashFile(written);
		else await app.vault.delete(written, true);
	}

	return JSON.stringify(results);
})()
`;

const answer = JSON.parse(evalInObsidian(script.replace(/\n\s*/g, ' ')));

if (answer.error) {
	console.error(`Cannot run: ${answer.error}`);
	process.exit(1);
}

const results = answer;

let failures = 0;
for (const result of results) {
	if (result.matches) {
		console.log(`ok   ${result.fixture} → ${result.notes} note(s), matches the recording`);
		continue;
	}

	failures++;
	console.log(`FAIL ${result.fixture}`);
	if (!result.found) console.log('     the import wrote no such note');
	if (result.failed?.length) console.log(`     reported failed: ${result.failed.join(', ')}`);
	if (result.produced !== undefined) {
		console.log('     produced:');
		console.log(result.produced.split('\n').map(line => '       ' + line).join('\n'));
	}
}

console.log(`\n${results.length - failures}/${results.length} match`);
process.exit(failures > 0 ? 1 : 0);
