/**
 * Converting each fixture and comparing against the recording beside it.
 *
 * Anything dropped in local/ is converted the same way, and records into
 * local/expected/ - which is gitignored, so a real notebook can be checked
 * here without any of it being committed.
 */

import { test } from 'node:test';
import nodeFs from 'node:fs';
import nodeOs from 'node:os';
import nodePath from 'node:path';

import { convertPage } from '../../src/formats/onenote-file/convert';
import { readSections } from '../../src/formats/onenote-file/package';
import { availableFileName, sanitizeFileName } from '../../src/util';
import { Fixture, expectedFor, expectTree, fixtures } from '../helpers';

const HERE = __dirname;

async function writeSections(fixture: Fixture, into: string): Promise<void> {
	const data = new Uint8Array(nodeFs.readFileSync(fixture.path));

	for (const entry of readSections(data, fixture.name)) {
		const section = entry.read();
		const sectionDir = nodePath.join(into, sanitizeFileName(section.name || entry.title));
		nodeFs.mkdirSync(sectionDir, { recursive: true });

		const taken = new Set<string>();

		for (const page of section.pages) {
			const attachments = nodePath.join(sectionDir, 'attachments');

			const converted = await convertPage(page, {
				saveAttachment: async (bytes, suggested) => {
					const fileName = availableFileName(sanitizeFileName(suggested), candidate => taken.has(candidate));
					taken.add(fileName);

					nodeFs.mkdirSync(attachments, { recursive: true });
					nodeFs.writeFileSync(nodePath.join(attachments, fileName), bytes);
					return { path: `attachments/${fileName}`, name: fileName };
				},
			});

			const noteName = availableFileName(`${sanitizeFileName(page.title)}.md`, candidate => taken.has(candidate));
			taken.add(noteName);

			const front = [
				'---',
				`title: ${JSON.stringify(page.title)}`,
				`level: ${page.level}`,
				...(page.createdUtc ? [`created: ${page.createdUtc.toISOString()}`] : []),
				...(page.lastModifiedUtc ? [`updated: ${page.lastModifiedUtc.toISOString()}`] : []),
				'---',
				'',
			].join('\n');

			nodeFs.writeFileSync(nodePath.join(sectionDir, noteName), front + converted.markdown + '\n');
		}
	}
}

const inputs = [
	...fixtures(nodePath.join(HERE, 'fixtures'), '.one'),
	...fixtures(HERE, '.onepkg'),
];

for (const fixture of inputs) {
	// The two Office365 fixtures use the packaging the reader does not open yet.
	if (fixture.name.startsWith('testOneNoteFromOffice365')) continue;

	test(`converts ${fixture.name}`, async () => {
		const produced = nodeFs.mkdtempSync(nodePath.join(nodeFs.realpathSync(nodeOs.tmpdir()), 'onenote-'));

		try {
			await writeSections(fixture, produced);
			expectTree(produced, expectedFor(fixture, fixture.name), fixture.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}
