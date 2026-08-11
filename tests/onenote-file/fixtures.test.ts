import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';

const FIXTURES = nodePath.join(__dirname, 'fixtures');

const HASHES: Record<string, string> = {
	'testOneNote.one': 'b614dc94b890b53db7cb2d3053382cb398c59385533c256e2509850cc3247270',
	'testOneNote2016.one': 'fcfc3c2e65482dc6f70f6a613b058e908f67db2ebb16a343bc2367e02bbb471c',
	'testOneNoteEmbeddedWordDoc.one': 'cf38e39cb5ced46f377c832e5ff0fa5e789945930f77c294ba5e866429a2a028',
	'testOneNoteFromOffice365.one': '093f20ecb2196f8e6c07cfa6d7c7acb65a50ad3126a95444fe33086a37aaa4d5',
	'testOneNoteFromOffice365-2.one': '8cd245ed549043534118a00ce29715147c880c38ca88c3481acc19ae28e980c2',
	'handwriting_recognition.one': '2cff8769ccf0af6209d96d5e0650661077edba2d2bae4e4aa691f06caea35456',
};

test('every fixture is the file its provenance claims', () => {
	for (const [name, expected] of Object.entries(HASHES)) {
		const digest = createHash('sha256').update(nodeFs.readFileSync(nodePath.join(FIXTURES, name))).digest('hex');

		assert.equal(digest, expected, `${name} is not the file SOURCE.md records`);
	}
});

test('the licences the fixtures are redistributed under are present', () => {
	for (const name of ['LICENSE-APACHE-2.0.txt', 'NOTICE.txt', 'LICENSE-MPL-2.0.txt', 'SOURCE.md']) {
		assert.ok(nodeFs.existsSync(nodePath.join(FIXTURES, name)), `${name} is missing`);
	}
});
