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
 * Compare a produced directory against a recorded one, recording it the first
 * time so a new fixture writes its own baseline to review.
 */
export function expectTree(produced: string, expectedDir: string, label: string): void {
	if (!nodeFs.existsSync(expectedDir)) {
		nodeFs.mkdirSync(nodePath.dirname(expectedDir), { recursive: true });
		nodeFs.cpSync(produced, expectedDir, { recursive: true });
		console.log(`Recorded a baseline for ${label} - review ${nodePath.relative(process.cwd(), expectedDir)}/`);
		return;
	}

	const problems = diffTrees(readTree(produced), readTree(expectedDir));
	assert.deepEqual(problems, [], `output differs from ${nodePath.relative(process.cwd(), expectedDir)}/\n${problems.join('\n')}`);
}

/**
 * The same, for a conversion that produces one document rather than a tree.
 */
export function expectFile(produced: string, expectedPath: string, label: string): void {
	if (!nodeFs.existsSync(expectedPath)) {
		nodeFs.mkdirSync(nodePath.dirname(expectedPath), { recursive: true });
		nodeFs.writeFileSync(expectedPath, produced);
		console.log(`Recorded a baseline for ${label} - review ${nodePath.relative(process.cwd(), expectedPath)}`);
		return;
	}

	assert.equal(produced, nodeFs.readFileSync(expectedPath, 'utf8'), `output differs from ${nodePath.relative(process.cwd(), expectedPath)}`);
}

/** Inputs in a directory with the given extension, in name order. */
export function fixtures(dir: string, extension: string): string[] {
	return nodeFs.readdirSync(dir).filter(name => name.endsWith(extension)).sort();
}
