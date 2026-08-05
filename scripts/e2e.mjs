/**
 * Run the fixtures through a real import, inside Obsidian.
 *
 * The test suite converts fixtures headlessly, against a shim of Obsidian's
 * API. This runs the same fixtures through the app itself - its
 * htmlToMarkdown, its vault, its link settings - and compares what lands in
 * the vault with what the suite recorded. It is what would catch the shim
 * drifting from the real thing.
 *
 *   npm run e2e
 *
 * Needs the Obsidian CLI, the plugin installed in the active vault, and a
 * build of the current source deployed to it (`npm run build` does not deploy;
 * `npm run dev` does).
 *
 * Everything it writes goes in one folder in the vault and is deleted after.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the import writes, and what is removed afterwards. */
const FOLDER = '_e2e-check';

/**
 * One fixture, and the recording to compare against.
 *
 * Only fixtures whose conversion does not depend on the vault: no attachments
 * to download, and nothing linking to another imported note, so what the app
 * writes is what the suite recorded. Anything else differs for good reasons -
 * a vault path, a link in the user's preferred form - and would need the
 * recording to know about them.
 */
const CASES = [
	{ importer: 'html', fixture: 'tests/html/links.html', expected: 'tests/html/expected/links.md', note: 'links.md' },
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
];

function evalInObsidian(code) {
	const result = spawnSync('obsidian', ['eval', `code=${code}`], {
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

const script = `
(async () => {
	const fs = require('fs');
	const plugin = app.plugins.plugins['obsidian-importer'];
	if (!plugin) return 'ERROR: the importer is not enabled in this vault';

	const cases = ${JSON.stringify(CASES)};
	const repo = ${JSON.stringify(repo)};
	const folder = ${JSON.stringify(FOLDER)};
	const results = [];

	for (const testCase of cases) {
		const ctx = await plugin.runImport(
			testCase.importer,
			[repo + '/' + testCase.fixture],
			folder);

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

	/* Everything this wrote, gone again */
	const written = app.vault.getAbstractFileByPath(folder);
	if (written) {
		if (app.fileManager.trashFile) await app.fileManager.trashFile(written);
		else await app.vault.delete(written, true);
	}

	return JSON.stringify(results);
})()
`;

// The CLI takes the code as one argument, so it goes over as a single line.
// Any comment inside it has to be a block comment to survive that.
const results = JSON.parse(evalInObsidian(script.replace(/\n\s*/g, ' ')));

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
