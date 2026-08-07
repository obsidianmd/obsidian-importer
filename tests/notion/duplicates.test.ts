/**
 * The names a Notion export takes in the vault.
 *
 * Notion cannot leave this to the write. A link to another page is written as
 * [[title]] while the export is being converted, so every title has to be
 * settled first, before a single file exists - which is what cleanDuplicates
 * does, and why it is the only place in this importer that answers what a
 * taken name becomes.
 *
 * It used to answer it with an exact comparison against the other pages in the
 * export, and not against the vault at all. On macOS and Windows "MYITEM.md"
 * and "Myitem.md" are one file, so the second was planned as free and the
 * write lost it to "File already exists" (#223); and a second import into a
 * folder already holding the first lost every note the same way.
 *
 * The pages here are built the way the importer sees them - through
 * recordFileInfo, from HTML carrying a Notion id and a title.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanDuplicates } from '../../src/formats/notion/clean-duplicates';
import { NotionResolverInfo } from '../../src/formats/notion/notion-types';
import { NotionExportEntry, recordFileInfo } from '../../src/formats/notion/parse-info';
import { MemoryVault } from '../shims/vault';

/** A Notion id: 32 characters, at the end of the file name. */
const notionId = (n: number) => String(n).padStart(32, 'a');

function page(title: string, n: number, folder = 'Export'): NotionExportEntry {
	const name = `${title} ${notionId(n)}.html`;

	return {
		filepath: `${folder}/${name}`,
		name,
		extension: 'html',
		text: `<html><head><title>${title}</title></head><body><article id="${notionId(n)}"></article></body></html>`,
	};
}

function attachment(name: string, folder = 'Export'): NotionExportEntry {
	return {
		filepath: `${folder}/${name}`,
		name,
		extension: name.split('.').pop() ?? '',
	};
}

/**
 * What cleanDuplicates plans for an export, with the vault already holding
 * `existing`.
 */
async function planned(entries: NotionExportEntry[], { existing = [] as string[], attachmentPath = '' } = {}) {
	const vault = new MemoryVault();
	for (const path of existing) await vault.create(path, '');

	const info = new NotionResolverInfo(attachmentPath, false);
	for (const entry of entries) recordFileInfo(info, entry);

	cleanDuplicates({
		info,
		vault: vault as never,
		targetFolderPath: 'Out/',
		parentsInSubfolders: false,
	});

	return info;
}

const titles = (info: NotionResolverInfo) => Object.values(info.idsToFileInfo).map(file => file.title);
const attachmentNames = (info: NotionResolverInfo) =>
	Object.values(info.pathsToAttachmentInfo).map(file => file.nameWithExtension);

test('pages differing only in case each get a name of their own', async () => {
	const info = await planned([
		page('MYITEM', 1),
		page('MYITEM', 2),
		page('Myitem', 3),
	]);

	assert.deepEqual(titles(info), ['MYITEM', 'MYITEM 1', 'Myitem 2']);
});

test('a name the vault already holds is a taken name', async () => {
	// The second import of an export. Every note used to fail here.
	const info = await planned([page('MYITEM', 1)], { existing: ['Out/Export/myitem.md'] });

	assert.deepEqual(titles(info), ['MYITEM 1']);
});

test('the same title in two folders is two free names', async () => {
	const info = await planned([
		page('MYITEM', 1, 'Export'),
		page('MYITEM', 2, 'Export/Nested'),
	]);

	assert.deepEqual(titles(info), ['MYITEM', 'MYITEM']);
});

test('a title that occurs elsewhere in the vault needs a full link path', async () => {
	const info = await planned([page('MYITEM', 1)], { existing: ['Elsewhere/myitem.md'] });

	assert.deepEqual(titles(info), ['MYITEM']);
	assert.deepEqual(Object.values(info.idsToFileInfo).map(file => file.fullLinkPathNeeded), [true]);
});

test('attachments differing only in case each get a name of their own', async () => {
	const info = await planned([
		attachment('Photo.png'),
		attachment('Photo.png', 'Export/Nested'),
		attachment('photo.png', 'Export/Deeper'),
	], { attachmentPath: 'Attachments' });

	assert.deepEqual(attachmentNames(info), ['Photo.png', 'Photo 1.png', 'photo 2.png']);
});

test('a renamed attachment keeps the name parse-info decoded, and its extension', async () => {
	// The suffix used to be appended to the name in the zip, which is
	// percent-encoded - the thing nameWithExtension exists to undo.
	const info = await planned([
		attachment('My%20Photo.PNG'),
		attachment('My%20Photo.PNG', 'Export/Nested'),
	], { attachmentPath: 'Attachments' });

	assert.deepEqual(attachmentNames(info), ['My Photo.PNG', 'My Photo 1.PNG']);
});
