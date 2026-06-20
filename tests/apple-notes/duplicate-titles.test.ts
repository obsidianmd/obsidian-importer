import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';

(globalThis as typeof globalThis & { window: { require: (request: string) => unknown } }).window = {
	require: ((request: string) => {
		switch (request) {
			case 'node:original-fs':
				return fs;
			case 'node:os':
				return os;
			case 'node:path':
				return path;
			case 'node:url':
				return url;
			case 'node:zlib':
				return zlib;
			case 'node:crypto':
				return crypto;
			case 'node:child_process':
				return childProcess;
			default:
				throw new Error(`Unexpected window.require(${request})`);
		}
	}),
};

class TFile {
	path: string;
	content: string;
	stat: { mtime: number };

	constructor(path: string, content = '') {
		this.path = path;
		this.content = content;
		this.stat = { mtime: 0 };
	}
}

class TFolder {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

const load = Module._load;
Module._load = function (request: string, parent: NodeModule | null, isMain: boolean) {
	if (request === 'obsidian') {
		return {
			Notice: class {},
			Platform: { isDesktop: true, isDesktopApp: true, isMacOS: true },
			Setting: class {},
			TFile,
			TFolder,
			moment: () => ({ format: () => '2026-06-20' }),
		};
	}

	return load.apply(this, [request, parent, isMain]);
};

type FakeFile = {
	path: string;
	content: string;
	stat: {
		mtime: number;
	};
};

async function makeImporter(rows: Record<number, Record<string, unknown>>) {
	const { AppleNotesImporter } = await import('../../src/formats/apple-notes');
	const folder = new TFolder('Apple Notes');
	const files = new Map<string, FakeFile>();

	const importer = Object.create(AppleNotesImporter.prototype);
	Object.assign(importer, {
		app: {
			fileManager: {
				async createNewMarkdownFile(targetFolder: typeof folder, title: string, content: string) {
					const ext = title.endsWith('.md') ? '.md' : '';
					const base = ext ? title.slice(0, -ext.length) : title;
					let path = `${targetFolder.path}/${title}`;
					let i = 1;
					while (files.has(path)) {
						path = `${targetFolder.path}/${base} ${i}${ext}`;
						i++;
					}

					const file = new TFile(path, content);
					files.set(path, file);
					return file;
				},
			},
		},
		ctx: {
			status() {},
			reportFailed() {},
			reportNoteSuccess() {},
			reportProgress() {},
			reportSkipped() {},
		},
		vault: {
			getAbstractFileByPath(targetPath: string) {
				return files.get(targetPath);
			},
			modify(file: FakeFile, content: string, options: { mtime?: number } = {}) {
				file.content = content;
				if (options.mtime) file.stat.mtime = options.mtime;
			},
		},
		database: {
			async get(_strings: TemplateStringsArray, ...values: unknown[]) {
				const id = values.at(-1) as number;
				return rows[id];
			},
		},
		resolvedFiles: {},
		resolvedFolders: { 1: folder },
		rootFolder: folder,
		owners: { 1: 1 },
		filePrefixFormat: '',
		duplicateHandling: 'import-updated',
		claimedNotePaths: new Set<string>(),
		noteCount: Object.keys(rows).length,
		parsedNotes: 0,
	});

	importer.decodeData = (hexdata: string) => ({
		format: async () => `Body for ${hexdata}`,
	}) as never;

	return { importer, files };
}

test('Apple Notes same-title source notes import as separate files', async () => {
	const { importer, files } = await makeImporter({
		1: {
			zhexdata: 'first',
			ZTITLE1: 'Shared title',
			ZFOLDER: 1,
			ZCREATIONDATE1: 1,
			ZCREATIONDATE2: null,
			ZCREATIONDATE3: null,
			ZMODIFICATIONDATE1: 2,
			ZISPASSWORDPROTECTED: false,
		},
		2: {
			zhexdata: 'second',
			ZTITLE1: 'Shared title',
			ZFOLDER: 1,
			ZCREATIONDATE1: 3,
			ZCREATIONDATE2: null,
			ZCREATIONDATE3: null,
			ZMODIFICATIONDATE1: 4,
			ZISPASSWORDPROTECTED: false,
		},
	});

	const first = await importer.resolveNote(1);
	const second = await importer.resolveNote(2);

	assert.equal(first?.path, 'Apple Notes/Shared title.md');
	assert.equal(second?.path, 'Apple Notes/Shared title 1.md');
	assert.equal(files.get('Apple Notes/Shared title.md')?.content, 'Body for first');
	assert.equal(files.get('Apple Notes/Shared title 1.md')?.content, 'Body for second');
});
