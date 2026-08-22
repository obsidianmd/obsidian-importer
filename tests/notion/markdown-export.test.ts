/**
 * What a user is told when the export is not the one this importer reads.
 *
 * Notion's own default is Markdown & CSV; the importer converts the HTML
 * export. The download wraps the real export in a second zip, so the walk that
 * meets the Markdown is the recursive one - and a failure reported there is
 * named after a file the user never chose. Reported without a reason, as it
 * was, it read as "Failed: Export-….zip" and nothing more.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { NodePickedFile, PickedFile, PickedFolder, provideNodeModules } from '../../src/filesystem';
import { NotionImporter, processZips } from '../../src/formats/notion';
import { i18n } from '../../src/i18n';
import { ImportContext } from '../../src/import-context';
import { PickedFolderLoad } from '../../src/picked-folder-tree';
import { memoryApp, MemoryVault } from '../shims/vault';

provideNodeModules({ fs: nodeFs, path: nodePath } as never);

test('a Markdown export is named as one rather than failing namelessly', async () => {
	const ctx = new ImportContext();
	const converted: string[] = [];

	await processZips(ctx, [new NodePickedFile(nodePath.join(__dirname, 'Notion.Test.Export.zip'))],
		async file => void converted.push(file.filepath));

	assert.deepEqual(ctx.log, [{
		outcome: 'failed',
		name: 'Notion.Test.Export.zip/Export-d2b14fbf-86de-4508-a1b2-6515ff8d7aab-Part-1.zip',
		reason: i18n.importer.notion.reasonMarkdownExport(),
	}], 'the export should be reported once, saying which export it is');

	assert.deepEqual(converted, [], 'nothing in a Markdown export converts');
	assert.ok(ctx.cancelled, 'the second pass over the zip should not run');
});

test('the source tree explains that a Markdown export cannot be imported', async () => {
	const subject = new NotionImporter(memoryApp(new MemoryVault()), {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: null,
		importerId: 'notion',
		abortController: new AbortController(),
	} as never);
	await subject.ready;

	const internals = subject as unknown as {
		folderPicker: {
			loadNodes(items: (PickedFile | PickedFolder)[], isCurrent: () => boolean): Promise<PickedFolderLoad>;
		};
	};
	const source = new NodePickedFile(nodePath.join(__dirname, 'Notion.Test.Export.zip'));

	await assert.rejects(
		() => internals.folderPicker.loadNodes([source], () => true),
		{ message: i18n.importer.notion.msgMarkdownExport() },
	);
});
