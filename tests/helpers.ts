/**
 * Shared machinery for fixture-driven conversion tests.
 *
 * Each importer's tests point at a directory of inputs and a matching
 * expected/ directory holding what the conversion should produce - real
 * markdown, real attachments, the files a user would end up with.
 *
 * Adding a fixture is: drop the input in, run the tests, review what appears.
 * Changing one on purpose is: delete its expected output, run the tests, read
 * the diff.
 */
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/** Every file under a directory, by path relative to it, in path order. */
export function readTree(dir: string): Map<string, Buffer> {
	const files = new Map<string, Buffer>();

	const walk = (current: string) => {
		for (const entry of nodeFs.readdirSync(current, { withFileTypes: true })) {
			const full = nodePath.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else files.set(nodePath.relative(dir, full).split(nodePath.sep).join('/'), nodeFs.readFileSync(full));
		}
	};
	walk(dir);

	return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

/** Extensions worth showing in full when they differ. */
const TEXT = ['.md', '.base', '.txt', '.json', '.csv'];

/**
 * How two trees differ, as lines, or nothing when they match.
 *
 * Text files show both sides, since that is the case worth reading; anything
 * else reports its size.
 */
export function diffTrees(actual: Map<string, Buffer>, expected: Map<string, Buffer>): string[] {
	const problems: string[] = [];

	for (const path of expected.keys()) {
		if (!actual.has(path)) problems.push(`missing: ${path}`);
	}
	for (const path of actual.keys()) {
		if (!expected.has(path)) problems.push(`unexpected: ${path}`);
	}

	for (const [path, actualBytes] of actual) {
		const expectedBytes = expected.get(path);
		if (!expectedBytes || actualBytes.equals(expectedBytes)) continue;

		if (TEXT.some(extension => path.endsWith(extension))) {
			problems.push(
				`differs: ${path}`,
				`  expected: ${JSON.stringify(expectedBytes.toString('utf8'))}`,
				`  actual:   ${JSON.stringify(actualBytes.toString('utf8'))}`,
			);
		}
		else {
			problems.push(`differs: ${path} (${expectedBytes.length} bytes expected, ${actualBytes.length} actual)`);
		}
	}

	return problems;
}

/**
 * Recording is opt-in, and always fails the run.
 *
 * A test that quietly records whatever it was given is not a test: whatever
 * the conversion happened to produce - correct or not - becomes the contract,
 * and the run goes green. So a missing recording is a failure, and writing one
 * takes UPDATE_EXPECTED=1 and still fails, to force a look at what was written
 * before it is committed.
 */
function record(write: () => void, expected: string, label: string): never {
	const where = nodePath.relative(process.cwd(), expected);

	if (!process.env.UPDATE_EXPECTED) {
		assert.fail(`No recorded output for ${label}. Re-run with UPDATE_EXPECTED=1 to record it at ${where}, then read what it wrote before committing.`);
	}

	nodeFs.mkdirSync(nodePath.dirname(expected), { recursive: true });
	write();
	assert.fail(`Recorded ${where} for ${label}. Read it, then re-run without UPDATE_EXPECTED.`);
}

/** Compare a produced directory against the recorded one. */
export function expectTree(produced: string, expectedDir: string, label: string): void {
	if (!nodeFs.existsSync(expectedDir)) {
		record(() => nodeFs.cpSync(produced, expectedDir, { recursive: true }), expectedDir, label);
	}

	const problems = diffTrees(readTree(produced), readTree(expectedDir));
	assert.deepEqual(problems, [], `output differs from ${nodePath.relative(process.cwd(), expectedDir)}/\n${problems.join('\n')}`);
}

/** The same, for a conversion that produces one document rather than a tree. */
export function expectFile(produced: string, expectedPath: string, label: string): void {
	if (!nodeFs.existsSync(expectedPath)) {
		record(() => nodeFs.writeFileSync(expectedPath, produced), expectedPath, label);
	}

	assert.equal(produced, nodeFs.readFileSync(expectedPath, 'utf8'), `output differs from ${nodePath.relative(process.cwd(), expectedPath)}`);
}

export interface Fixture {
	/** File name, including the extension. */
	name: string;
	/** Full path to the input. */
	path: string;
	/** Whether it came from the uncommitted local/ directory. */
	local: boolean;
}

/**
 * Inputs to convert: the ones committed here, plus anything in local/.
 *
 * local/ is gitignored, and exists for files that cannot be committed - a
 * user's export attached to an issue, most of the time. Drop one in, run the
 * tests, and its conversion is recorded beside it in local/expected/ for you
 * to read. Nothing about that leaves the machine.
 *
 * A committed fixture and a local one behave identically otherwise, so a case
 * that turns out to be worth keeping can be moved up a directory - with the
 * reporter's say-so, and their data checked - and it keeps working.
 */
export function fixtures(dir: string, extension: string): Fixture[] {
	const found: Fixture[] = [];

	for (const [from, local] of [[dir, false], [nodePath.join(dir, 'local'), true]] as [string, boolean][]) {
		if (!nodeFs.existsSync(from)) continue;

		for (const name of nodeFs.readdirSync(from).sort()) {
			if (!name.endsWith(extension)) continue;
			found.push({ name, path: nodePath.join(from, name), local });
		}
	}

	return found;
}

/**
 * Where a fixture's recording belongs: beside the fixture itself.
 *
 * That keeps a local fixture's output inside the gitignored directory without
 * anything having to branch on it.
 */
export function expectedFor(fixture: Fixture, ...leaf: string[]): string {
	return nodePath.join(nodePath.dirname(fixture.path), 'expected', ...leaf);
}
