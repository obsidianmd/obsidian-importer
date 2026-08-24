/** Build an importer around a fixture database without invoking its dialog. */
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { Root } from 'protobufjs';

import { DuplicateHandling } from '../../src/format-importer';
import { AppleNotesImporter } from '../../src/formats/apple-notes';
import { descriptor } from '../../src/formats/apple-notes/descriptor';
import { MemoryVault } from '../shims/vault';
import { buildStore, NoteSpec } from './store';

class TestingAppleNotesImporter extends AppleNotesImporter {
	useInlineTemplate(template: string): void {
		this.inlineTemplate = template;
	}
}

export function reporter() {
	const skipped: string[] = [];
	return {
		skipped,
		ctx: {
			isCancelled: () => false,
			shouldStop: async () => false,
			status: () => {},
			reportProgress: () => {},
			reportNoteSuccess: () => {},
			reportAttachmentSuccess: () => {},
			reportSkipped: (name: string) => skipped.push(name),
			reportFailed: (name: string, reason?: unknown) => assert.fail(`${name}: ${String(reason)}`),
		},
	};
}

export async function importing(
	notes: NoteSpec[],
	mode: DuplicateHandling,
	options: { inlineTemplate?: string; saveSourceId?: boolean } = {},
) {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), { notes });

	const vault = new MemoryVault();
	const { ctx, skipped } = reporter();
	const subject = new TestingAppleNotesImporter(
		{ vault, loadLocalStorage: () => null, saveLocalStorage: () => {} } as never,
		{ sourceEl: null, optionsEl: null } as never
	);

	subject.ctx = ctx as never;
	subject.vault = vault as never;
	subject.rootFolder = vault.root;
	subject.protobufRoot = Root.fromJSON(descriptor);
	subject.duplicateHandling = mode;
	subject.saveSourceId = options.saveSourceId ?? false;
	if (options.inlineTemplate !== undefined) subject.useInlineTemplate(options.inlineTemplate);
	subject.keys = Object.fromEntries(
		(await store.database.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
	);
	subject.database = store.database;

	return {
		vault, skipped, notePks: store.notePks, subject,
		resolve: (pk: number) => subject.resolveNote(pk),
		close: () => {
			store.close();
			nodeFs.rmSync(dir, { recursive: true, force: true });
		},
	};
}
