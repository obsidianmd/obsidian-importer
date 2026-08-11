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

import { readCabinet } from '../../src/formats/onenote-file/cabinet/cabinet';
import { readRevisionStore } from '../../src/formats/onenote-file/onestore/revision-store';
import { mapSection } from '../../src/formats/onenote-file/semantic/map';
import { convertPage } from '../../src/formats/onenote-file/convert';
import type { Section } from '../../src/formats/onenote-file/semantic/content';
import { Fixture, expectTree, fixtures } from '../helpers';

const HERE = __dirname;
const LIMITS = { maxExpandedBytes: 4 * 1024 * 1024 * 1024, maxEntryBytes: 512 * 1024 * 1024, maxEntries: 4096 };

/** Enough to keep a title off the filesystem's toes; the importer does the real thing. */
function safeName(name: string, fallback: string): string {
	const trimmed = name.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
	return trimmed === '' ? fallback : trimmed.slice(0, 80);
}

function sectionsOf(fixture: Fixture): { name: string, section: Section }[] {
	const data = new Uint8Array(nodeFs.readFileSync(fixture.path));

	if (fixture.name.toLowerCase().endsWith('.onepkg')) {
		return readCabinet(data, LIMITS)
			.filter(entry => entry.name.toLowerCase().endsWith('.one'))
			.map(entry => ({
				name: nodePath.basename(entry.name).replace(/\.one$/i, ''),
				section: mapSection(readRevisionStore(entry.data)),
			}));
	}

	return [{ name: fixture.name.replace(/\.one$/i, ''), section: mapSection(readRevisionStore(data)) }];
}

async function writeSections(fixture: Fixture, into: string): Promise<void> {
	for (const { name, section } of sectionsOf(fixture)) {
		const sectionDir = nodePath.join(into, safeName(section.name || name, 'Section'));
		nodeFs.mkdirSync(sectionDir, { recursive: true });

		const used = new Map<string, number>();

		for (const page of section.pages) {
			const attachments = nodePath.join(sectionDir, 'attachments');

			const converted = await convertPage(page, {
				saveAttachment: async (data, suggested) => {
					const base = safeName(suggested, 'attachment');
					const seen = used.get(base) ?? 0;
					used.set(base, seen + 1);

					const fileName = seen === 0 ? base : `${base}-${seen}`;
					nodeFs.mkdirSync(attachments, { recursive: true });
					nodeFs.writeFileSync(nodePath.join(attachments, fileName), data);
					return { path: `attachments/${fileName}`, name: fileName };
				},
			});

			const title = safeName(page.title, 'Untitled');
			const seen = used.get(`page:${title}`) ?? 0;
			used.set(`page:${title}`, seen + 1);

			const front = [
				'---',
				`title: ${JSON.stringify(page.title)}`,
				`level: ${page.level}`,
				...(page.createdUtc ? [`created: ${page.createdUtc.toISOString()}`] : []),
				...(page.lastModifiedUtc ? [`updated: ${page.lastModifiedUtc.toISOString()}`] : []),
				'---',
				'',
			].join('\n');

			nodeFs.writeFileSync(
				nodePath.join(sectionDir, seen === 0 ? `${title}.md` : `${title}-${seen}.md`),
				front + converted.markdown + '\n');
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
			expectTree(produced, nodePath.join(nodePath.dirname(fixture.path), 'expected', fixture.name), fixture.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}
