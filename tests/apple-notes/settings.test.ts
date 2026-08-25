import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { Platform, Setting } from 'obsidian';
import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling, ImporterHost } from '../../src/format-importer';
import { parseFrontMatterBlock } from '../../src/util';
import { AppleNotesImporter } from '../../src/formats/apple-notes';
import { MemoryVault, memoryApp } from '../shims/vault';
import { importing } from './importing';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

const SOFT_RETURN = '\u2028';

const NOTE = [{
	title: 'Soft returns',
	runs: [{ text: `Soft returns\nA paragraph${SOFT_RETURN}broken by a soft return.` }],
}];

test('the unavailable mobile importer offers its instructions', () => {
	let instructions = 0;
	class MobileAppleNotesImporter extends AppleNotesImporter {
		protected addInstructions(setting: Setting | null): Setting | null {
			instructions++;
			return setting;
		}
	}

	const original = {
		isDesktop: Platform.isDesktop,
		isMacOS: Platform.isMacOS,
		isMobile: Platform.isMobile,
	};

	try {
		Object.assign(Platform, { isDesktop: false, isMacOS: false, isMobile: true });
		const importer = new MobileAppleNotesImporter(memoryApp(new MemoryVault()), {
			sourceEl: null,
			outputEl: null,
			optionsEl: null,
			helpPermalink: 'import/apple-notes',
		} as ImporterHost);

		assert.equal(importer.notAvailable, true);
		assert.equal(instructions, 1);
	}
	finally {
		Object.assign(Platform, original);
	}
});

test('a soft return is a bare newline when the vault leaves strict line breaks off', async () => {
	const run = await importing(NOTE, DuplicateHandling.CreateCopy);

	try {
		const file = await run.resolve(run.notePks[0]);
		const body = String(run.vault.contents.get(file!.path));

		assert.ok(body.contains('A paragraph\nbroken'), `got ${JSON.stringify(body)}`);
	}
	finally {
		run.close();
	}
});

test('a soft return is spelled out when the vault has strict line breaks on', async () => {
	const run = await importing(NOTE, DuplicateHandling.CreateCopy);
	run.vault.config.set('strictLineBreaks', true);

	try {
		const file = await run.resolve(run.notePks[0]);
		const body = String(run.vault.contents.get(file!.path));

		assert.ok(body.contains('A paragraph  \nbroken'), `got ${JSON.stringify(body)}`);
	}
	finally {
		run.close();
	}
});

test('templates can preserve whether an Apple Note was pinned', async () => {
	const run = await importing([{
		title: 'Important note',
		pinned: true,
		runs: [{ text: 'Important note\nPinned content.' }],
	}], DuplicateHandling.CreateCopy, {
		inlineTemplate: '---\npinned: {{isPinned}}\n---\n{{content}}',
	});

	try {
		const file = await run.resolve(run.notePks[0]);
		const content = String(run.vault.contents.get(file!.path));

		assert.equal(parseFrontMatterBlock(content)?.frontMatter.pinned, true);
	}
	finally {
		run.close();
	}
});
