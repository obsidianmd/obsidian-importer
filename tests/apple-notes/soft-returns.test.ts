import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NoteConverter } from '../../src/formats/apple-notes/convert-note';
import { ANDocument, ANAttributeRun, ANStyleType } from '../../src/formats/apple-notes/models';
import { AppleNotesImporter } from '../../src/formats/apple-notes';

const attrType = { fieldsArray: [] };

function run(text: string, styleType: ANStyleType = ANStyleType.Default): ANAttributeRun {
	return {
		$type: attrType,
		length: text.length,
		paragraphStyle: { styleType, indentAmount: 0 }
	} as ANAttributeRun;
}

async function convert(parts: string[], runs: ANAttributeRun[]): Promise<string> {
	const importer = {
		omitFirstLine: false,
		app: { fileManager: {} }
	} as unknown as AppleNotesImporter;

	const document = {
		note: {
			noteText: parts.join(''),
			attributeRun: runs,
			version: 1
		}
	} as ANDocument;

	return new NoteConverter(importer, document).format();
}

test('preserves Apple Notes soft returns inside a bullet item', async () => {
	const text = 'First line\nSecond line';

	assert.equal(
		await convert([text], [run(text, ANStyleType.DottedList)]),
		'- First line<br>Second line'
	);
});

test('keeps separate Apple Notes bullet paragraphs as separate list items', async () => {
	const first = 'First item\n';
	const second = 'Second item';

	assert.equal(
		await convert([first, second], [
			run(first, ANStyleType.DottedList),
			run(second, ANStyleType.DottedList)
		]),
		'- First item\n- Second item'
	);
});

test('preserves Apple Notes soft returns in normal paragraphs', async () => {
	const text = 'First line\nSecond line';

	assert.equal(
		await convert([text], [run(text)]),
		'First line<br>Second line'
	);
});
