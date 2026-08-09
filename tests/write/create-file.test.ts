import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

class WritingImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}
}

function importer(configure?: (vault: MemoryVault) => void): { vault: MemoryVault, subject: WritingImporter } {
	const vault = new MemoryVault();
	configure?.(vault);
	const subject = new WritingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);

	return { vault, subject };
}

test('a free name is used as it is', async () => {
	const { vault, subject } = importer();

	const file = await subject.createFile(vault.root, 'Note.md', 'first');

	assert.equal(file.path, 'Note.md');
	assert.deepEqual(vault.paths(), ['Note.md']);
});

test('a taken name gets a number, and the note there is left alone', async () => {
	const { vault, subject } = importer();

	await subject.createFile(vault.root, 'Note.md', 'first');
	const second = await subject.createFile(vault.root, 'Note.md', 'second');
	const third = await subject.createFile(vault.root, 'Note.md', 'third');

	assert.equal(second.path, 'Note 1.md');
	assert.equal(third.path, 'Note 2.md');
	assert.equal(await vault.read(await subject.createFile(vault.root, 'Other.md', 'x')), 'x');
	assert.equal(vault.contents.get('Note.md'), 'first');
});

test('a name that differs only in case is a taken name', async () => {
	const { vault, subject } = importer();

	await subject.createFile(vault.root, 'Note.md', 'first');
	const second = await subject.createFile(vault.root, 'note.md', 'second');

	assert.equal(second.path, 'note 1.md');
	assert.equal(vault.contents.get('Note.md'), 'first');
});

test('an attachment is given a free name too', async () => {
	const { vault, subject } = importer();
	const data = new TextEncoder().encode('bytes').buffer;

	const first = await subject.createBinaryFile(vault.root, 'photo.jpg', data);
	const second = await subject.createBinaryFile(vault.root, 'photo.jpg', data);

	assert.equal(first.path, 'photo.jpg');
	assert.equal(second.path, 'photo 1.jpg');
});

test('an attachment follows the vault subfolder setting relative to its note', async () => {
	const { subject } = importer(vault => vault.config.set('attachmentFolderPath', './media'));
	await subject.createFolders('Imported/Nested');

	assert.equal(
		await subject.getAvailablePathForAttachment('photo.jpg', [], 'Imported/Nested/Note.md'),
		'Imported/Nested/media/photo.jpg'
	);
});

test('the vault setting is only where the output step starts, not where it ends', async () => {
	const { vault, subject } = importer(vault => vault.config.set('attachmentFolderPath', './media'));
	await subject.createFolders('Imported/Nested');

	subject.attachmentLocation = { mode: 'folder', path: 'Files' };

	assert.equal(
		await subject.getAvailablePathForAttachment('photo.jpg', [], 'Imported/Nested/Note.md'),
		'Files/photo.jpg'
	);
	assert.equal(vault.config.get('attachmentFolderPath'), './media');
});

test('each attachment location puts the file where it says', async () => {
	const notePath = 'Imported/Nested/Note.md';
	const cases: [Parameters<typeof importer>[0], { mode: 'vault' | 'folder' | 'note' | 'subfolder', path: string }, string][] = [
		[undefined, { mode: 'vault', path: '' }, 'photo.jpg'],
		[undefined, { mode: 'folder', path: 'Attachments' }, 'Attachments/photo.jpg'],
		[undefined, { mode: 'note', path: '' }, 'Imported/Nested/photo.jpg'],
		[undefined, { mode: 'subfolder', path: 'media' }, 'Imported/Nested/media/photo.jpg'],
	];

	for (const [configure, location, expected] of cases) {
		const { subject } = importer(configure);
		await subject.createFolders('Imported/Nested');
		subject.attachmentLocation = location;

		assert.equal(await subject.getAvailablePathForAttachment('photo.jpg', [], notePath), expected, location.mode);
	}
});

test('an attachment with nowhere to be relative to falls back to the output folder', async () => {
	const { subject } = importer();
	subject.outputLocation = 'Imported';
	subject.attachmentLocation = { mode: 'subfolder', path: 'media' };

	assert.equal(
		await subject.getAvailablePathForAttachment('photo.jpg', []),
		'Imported/media/photo.jpg'
	);
});

test('Markdown finalization reports failures, restores status, and clears its run', async () => {
	const vault = new MemoryVault();
	const app = memoryApp(vault) as unknown as {
		metadataCache?: { computeMetadataAsync: () => Promise<never> };
	};
	app.metadataCache = {
		computeMetadataAsync: async () => { throw new Error('parser failed'); },
	};
	const subject = new WritingImporter(app as never, { sourceEl: null, optionsEl: null } as never);
	await subject.createFile(vault.root, 'Note.md', 'body');
	const ctx = new ImportContext();
	ctx.status('Import complete');

	await subject.finalizeMarkdownOutput(ctx);

	assert.deepEqual(ctx.failed, ['Note.md']);
	assert.equal(ctx.statusMessage, 'Import complete');

	await subject.finalizeMarkdownOutput(ctx);
	assert.deepEqual(ctx.failed, ['Note.md']);
});

test('a note keeps the extension it was given, and only that one', async () => {
	const { vault, subject } = importer();

	assert.equal((await subject.saveAsMarkdownFile(vault.root, 'Plain', '')).path, 'Plain.md');
	assert.equal((await subject.saveAsMarkdownFile(vault.root, 'Carried.md', '')).path, 'Carried.md');
	assert.equal((await subject.saveAsMarkdownFile(vault.root, 'Dotted.name.here', '')).path, 'Dotted.name.here.md');
});

test('a title a file name cannot hold is sanitized before the name is picked', async () => {
	const { vault, subject } = importer();

	const file = await subject.saveAsMarkdownFile(vault.root, 'Q1/Q2 plan.', '');

	assert.equal(file.path, 'Q1-Q2 plan.md');
});

test('markdown is written with the indent the vault uses', async () => {
	const { vault, subject } = importer();
	vault.config.set('useTab', true);

	const file = await subject.saveAsMarkdownFile(vault.root, 'Outline', '- one\n    - two');

	assert.equal(await vault.read(file), '- one\n\t- two');
});

test('a file that is not markdown is written as it was given', async () => {
	const { vault, subject } = importer();
	vault.config.set('useTab', true);

	const file = await subject.createFile(vault.root, 'View.base', 'views:\n    - type: table');

	assert.equal(await vault.read(file), 'views:\n    - type: table');
});

class PickingImporter extends WritingImporter {
	sawDefaultPath: string | undefined;
	answerWith: string[] = [];

	protected chooseFrom(options: Record<string, unknown>, defaultPath?: string): string[] {
		this.sawDefaultPath = this.pickerOpensAt(defaultPath);
		if (this.answerWith.length > 0) this.rememberSourceFolder(this.answerWith[0]);
		return this.answerWith;
	}

	opensAt(defaultPath?: string) {
		return this.pickerOpensAt(defaultPath);
	}

	picked(filepath: string) {
		this.rememberSourceFolder(filepath);
	}
}

function picker(): PickingImporter {
	return new PickingImporter(memoryApp(new MemoryVault()), { sourceEl: null, optionsEl: null } as never);
}

class DialogImporter extends WritingImporter {
	choose(options: Record<string, unknown>, defaultPath?: string) {
		return this.chooseFrom(options, defaultPath);
	}
}

function withStubbedDialog<T>(answer: string[], use: (calls: Record<string, unknown>[]) => T): T {
	const calls: Record<string, unknown>[] = [];
	const globals = globalThis as unknown as { window?: Record<string, unknown> };
	const had = globals.window;

	globals.window = {
		...had,
		electron: { remote: { dialog: { showOpenDialogSync: (options: Record<string, unknown>) => {
			calls.push(options);
			return answer.length > 0 ? answer : undefined;
		} } } },
	};

	try {
		return use(calls);
	}
	finally {
		if (had === undefined) delete globals.window;
		else globals.window = had;
	}
}

test('the folder the picker opens at is the one handed to the dialog', () => {
	const subject = new DialogImporter(memoryApp(new MemoryVault()), { sourceEl: null, optionsEl: null } as never);

	withStubbedDialog(['/Users/someone/Exports/notes.enex'], calls => {
		subject.choose({ title: 'Pick files to import' });
		assert.equal(calls[0].defaultPath, undefined, 'nothing to go on the first time');

		subject.choose({ title: 'Pick files to import' });
		assert.equal(calls[1].defaultPath, '/Users/someone/Exports', 'where the last pick came from');
	});
});

test('a cancelled dialog changes nothing', () => {
	const subject = new DialogImporter(memoryApp(new MemoryVault()), { sourceEl: null, optionsEl: null } as never);

	withStubbedDialog(['/Users/someone/Exports/notes.enex'], () => subject.choose({}));

	withStubbedDialog([], calls => {
		assert.deepEqual(subject.choose({}), []);
		assert.equal(calls[0].defaultPath, '/Users/someone/Exports');
	});

	withStubbedDialog(['/elsewhere/x.enex'], calls => {
		subject.choose({});
		assert.equal(calls[0].defaultPath, '/Users/someone/Exports', 'still the last folder actually picked');
	});
});

test('with nothing to go on the picker is left to open where it likes', () => {
	assert.equal(picker().opensAt(), undefined);
});

test('the folder a pick came from is where the next one starts', () => {
	const subject = picker();

	subject.picked('/Users/someone/Exports/notes.enex');

	assert.equal(subject.opensAt(), '/Users/someone/Exports');
});

test('a folder this importer was pointed at beats one it worked out itself', () => {
	const subject = picker();

	assert.equal(subject.opensAt('/Users/someone/Library/Tomboy'), '/Users/someone/Library/Tomboy');

	subject.picked('/Volumes/Backup/tomboy/note.note');

	assert.equal(subject.opensAt('/Users/someone/Library/Tomboy'), '/Volumes/Backup/tomboy');
});
