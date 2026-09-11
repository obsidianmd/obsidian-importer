import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';

import { convertSheet, convertSheetToMarkdown, parseXMindJson, parseXMindXml, XMindData } from '../../src/formats/xmind/convert';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

async function readXMindZip(path: string): Promise<XMindData> {
	const bytes = nodeFs.readFileSync(path);
	const reader = new ZipReader(new BlobReader(new Blob([bytes as unknown as BlobPart])));
	const entries = await reader.getEntries();

	for (const entry of entries) {
		if (!entry.getData) continue;

		if (entry.filename === 'content.json') {
			const text = await entry.getData(new TextWriter());
			await reader.close();
			return parseXMindJson(text);
		}

		if (entry.filename === 'content.xml') {
			const text = await entry.getData(new TextWriter());
			await reader.close();
			return parseXMindXml(text);
		}
	}

	await reader.close();
	throw new Error(`No content.json or content.xml in ${path}`);
}

const xmindFiles = fixtures(FIXTURES, '.xmind');

test('there are fixtures to convert', () => {
	assert.ok(xmindFiles.length > 0, 'expected at least one .xmind in tests/xmind');
});

for (const fixture of xmindFiles) {
	test(`converts ${fixture.name}`, async () => {
		const data = await readXMindZip(fixture.path);
		const baseName = nodePath.basename(fixture.name, '.xmind');

		for (const sheet of data.sheets) {
			const title = data.sheets.length > 1
				? `${baseName} - ${sheet.title}`
				: baseName;

			const markdown = convertSheetToMarkdown(sheet);
			expectFile(markdown, expectedFor(fixture, baseName, `${title}.md`), `${fixture.name} / ${sheet.title}`);
		}
	});

	for (const depth of [1, 2]) {
		test(`splits ${fixture.name} at depth ${depth}`, async () => {
			const data = await readXMindZip(fixture.path);
			const baseName = nodePath.basename(fixture.name, '.xmind');
			const multiSheet = data.sheets.length > 1;

			for (const sheet of data.sheets) {
				const notes = convertSheet(sheet, depth);
				const sheetPrefix = multiSheet ? `${sheet.title}/` : '';
				const splitDir = `${baseName}-split${depth}`;

				const seen = new Map<string, number>();
				for (const note of notes) {
					const key = [...note.path, note.title].join('/');
					const count = seen.get(key) ?? 0;
					seen.set(key, count + 1);
					const suffix = count > 0 ? ` ${count + 1}` : '';
					const notePath = [...note.path, `${note.title}${suffix}.md`].join('/');
					expectFile(
						note.content,
						expectedFor(fixture, splitDir, `${sheetPrefix}${notePath}`),
						`${fixture.name} split-${depth} / ${sheetPrefix}${notePath}`,
					);
				}
			}
		});
	}
}
