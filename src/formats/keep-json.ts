import { FrontMatterCache, Notice, normalizePath, Setting, TFile, TFolder } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ATTACHMENT_EXTS, ImportContext } from '../main';
import { sanitizeFileName, serializeFrontMatter } from '../util';
import { readZip, ZipEntryFile } from '../zip';
import { KeepJson } from './keep/models';
import { sanitizeTag, sanitizeTags, toSentenceCase } from './keep/util';


const BUNDLE_EXTS = ['zip'];
const NOTE_EXTS = ['json'];
// Ignore the following files:
// - Html duplicates
// - Another html summary
// - A text file with labels summary
const ZIP_IGNORED_EXTS = ['html', 'txt'];

type ExistingFileBehavior = 'skip' | 'overwrite' | 'duplicate';

// Keep exports use microseconds since epoch in `*TimestampUsec`
const KEEP_TIMESTAMP_MIN_MS = Date.UTC(1990, 0, 1);
const KEEP_TIMESTAMP_MAX_MS = Date.UTC(2100, 0, 1);

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'string' && value.trim() !== '') {
		const num = Number(value);
		return Number.isFinite(num) ? num : undefined;
	}
	return undefined;
}

/**
 * Normalize an epoch timestamp to milliseconds.
 *
 * Examples:
 * - `1690426307496000` (usec) -> `1690426307496` (ms)
 * - `1690426307496` (ms) -> `1690426307496` (ms)
 * - `1690426307` (sec) -> `1690426307000` (ms)
 */
function normalizeEpochMs(value: unknown): number | undefined {
	const num = toFiniteNumber(value);
	if (num === undefined || num <= 0) return undefined;

	const candidates = [
		num, // milliseconds
		num / 1_000, // microseconds
		num * 1_000, // seconds
	];

	const plausible = candidates.filter(ms => ms >= KEEP_TIMESTAMP_MIN_MS && ms <= KEEP_TIMESTAMP_MAX_MS);
	if (plausible.length === 0) return undefined;
	if (plausible.length === 1) return plausible[0];

	const now = Date.now();
	plausible.sort((a, b) => Math.abs(a - now) - Math.abs(b - now));
	return plausible[0];
}

export class KeepImporter extends FormatImporter {
	importArchivedSetting: Setting;
	importTrashedSetting: Setting;
	existingFileSetting: Setting;
	importArchived: boolean = false;
	importTrashed: boolean = false;
	existingFileBehavior: ExistingFileBehavior = 'skip';

	init() {
		this.importArchived = this.importArchived ?? false;
		this.importTrashed = this.importTrashed ?? false;
		this.existingFileBehavior = this.existingFileBehavior ?? 'skip';

		this.addFileChooserSetting('Notes & attachments', [...BUNDLE_EXTS, ...NOTE_EXTS, ...ATTACHMENT_EXTS], true);

		this.importArchivedSetting = new Setting(this.modal.contentEl)
			.setName('Import archived notes')
			.setDesc('If imported, files archived in Google Keep will be tagged as archived.')
			.addToggle(toggle => {
				toggle.setValue(this.importArchived);
				toggle.onChange(async (value) => {
					this.importArchived = value;
				});
			});

		this.importTrashedSetting = new Setting(this.modal.contentEl)
			.setName('Import deleted notes')
			.setDesc('If imported, files deleted in Google Keep will be tagged as deleted. Deleted notes will only exist in your Google export if deleted recently.')
			.addToggle(toggle => {
				toggle.setValue(this.importTrashed);
				toggle.onChange(async (value) => {
					this.importTrashed = value;
				});
			});

		this.existingFileSetting = new Setting(this.modal.contentEl)
			.setName('If note or attachment already exists')
			.setDesc('When importing into the same folder again, choose to skip, overwrite, or create a duplicate.')
			.addDropdown(dropdown => {
				dropdown.addOption('skip', 'Skip');
				dropdown.addOption('overwrite', 'Overwrite');
				dropdown.addOption('duplicate', 'Create duplicate');
				dropdown.setValue(this.existingFileBehavior);
				dropdown.onChange(value => {
					this.existingFileBehavior = value as ExistingFileBehavior;
				});
			});

		this.addOutputLocationSetting('Google Keep');

	}

	async import(ctx: ImportContext): Promise<void> {
		let { files } = this;

		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to import your files to.');
			return;
		}
		let assetFolderPath = `${folder.path}/Assets`;

		for (let file of files) {
			if (ctx.isCancelled()) return;
			await this.handleFile(file, folder, assetFolderPath, ctx);
		}
	}

	async handleFile(file: PickedFile, folder: TFolder, assetFolderPath: string, ctx: ImportContext) {
		let { fullpath, name, extension } = file;
		ctx.status('Processing ' + name);
		try {
			if (extension === 'zip') {
				await this.readZipEntries(file, folder, assetFolderPath, ctx);
			}
			else if (extension === 'json') {
				await this.importKeepNote(file, folder, ctx);
			}
			else if (ATTACHMENT_EXTS.contains(extension)) {
				ctx.status('Importing attachment ' + name);
				const imported = await this.copyFile(file, assetFolderPath, ctx);
				if (imported) {
					ctx.reportAttachmentSuccess(fullpath);
				}
			}
			// Don't mention skipped files when parsing zips, because
			else if (!(file instanceof ZipEntryFile) && !ZIP_IGNORED_EXTS.contains(extension)) {
				ctx.reportSkipped(fullpath);
			}
		}
		catch (e) {
			ctx.reportFailed(fullpath, e);
		}
	}

	async readZipEntries(file: PickedFile, folder: TFolder, assetFolderPath: string, ctx: ImportContext) {
		await readZip(file, async (zip, entries) => {
			for (let entry of entries) {
				if (ctx.isCancelled()) return;
				await this.handleFile(entry, folder, assetFolderPath, ctx);
			}
		});
	}

	async importKeepNote(file: PickedFile, folder: TFolder, ctx: ImportContext) {
		let { fullpath, basename } = file;
		ctx.status('Importing note ' + basename);

		let content = await file.readText();

		const keepJson = JSON.parse(content) as KeepJson;
		if (!keepJson || typeof keepJson !== 'object') {
			ctx.reportFailed(fullpath, 'Invalid Google Keep JSON');
			return;
		}

		const createdMs = normalizeEpochMs(keepJson.createdTimestampUsec);
		const editedMs = normalizeEpochMs(keepJson.userEditedTimestampUsec);
		if (!createdMs && !editedMs) {
			ctx.reportFailed(fullpath, 'Invalid Google Keep JSON');
			return;
		}
		if (keepJson.isArchived && !this.importArchived) {
			ctx.reportSkipped(fullpath, 'Archived note');
			return;
		}
		if (keepJson.isTrashed && !this.importTrashed) {
			ctx.reportSkipped(fullpath, 'Deleted note');
			return;
		}

		const imported = await this.convertKeepJson(keepJson, folder, basename, fullpath, ctx);
		if (imported) {
			ctx.reportNoteSuccess(fullpath);
		}
	}

	// Keep assets usually have unique filenames, but re-imports can conflict.
	async copyFile(file: PickedFile, folderPath: string, ctx: ImportContext): Promise<boolean> {
		let assetFolder = await this.createFolders(folderPath);
		const defaultPath = normalizePath(`${assetFolder.path}/${file.name}`);
		const existing = this.vault.getAbstractFileByPath(defaultPath) ?? this.vault.getAbstractFileByPathInsensitive(defaultPath);
		if (existing) {
			if (existing instanceof TFile) {
				if (this.existingFileBehavior === 'skip') {
					ctx.reportSkipped(file.fullpath, 'Attachment already exists');
					return false;
				}
				if (this.existingFileBehavior === 'overwrite') {
					let data = await file.read();
					await this.vault.modifyBinary(existing, data);
					return true;
				}
				// For duplicate notes, prefer reusing existing attachments rather than
				// creating renamed duplicates that the note wouldn't reference.
				return false;
			}
			else {
				ctx.reportSkipped(file.fullpath, 'Attachment path exists and is not a file');
				return false;
			}
		}

		let data = await file.read();
		await this.vault.createBinary(defaultPath, data);
		return true;
	}

	async convertKeepJson(keepJson: KeepJson, folder: TFolder, filename: string, sourcePath: string, ctx: ImportContext): Promise<boolean> {
		let mdContent: string[] = [];

		// First let's gather some metadata
		let frontMatter: FrontMatterCache = {};

		// Store both:
		// - the original Keep fields (as microseconds, matching the JSON field names)
		// - ISO strings for easy reading/searching in Obsidian
		const createdMs = normalizeEpochMs(keepJson.createdTimestampUsec);
		const editedMs = normalizeEpochMs(keepJson.userEditedTimestampUsec) ?? createdMs;

		if (createdMs !== undefined) frontMatter['keepCreatedAt'] = new Date(createdMs).toISOString();
		if (editedMs !== undefined) frontMatter['keepUpdatedAt'] = new Date(editedMs).toISOString();

		// Aliases
		if (keepJson.title) {
			let aliases = keepJson.title.split('\n').filter(a => a !== filename);

			if (aliases.length > 0) {
				frontMatter['aliases'] = aliases;
			}
		}

		let tags: string[] = [];
		// Add in tags to represent Keep properties
		if (keepJson.color && keepJson.color !== 'DEFAULT') {
			let colorName = keepJson.color.toLowerCase();
			colorName = toSentenceCase(colorName);
			tags.push(`Keep/Color/${colorName}`);
		}
		if (keepJson.isPinned) tags.push('Keep/Pinned');
		if (keepJson.attachments) tags.push('Keep/Attachment');
		if (keepJson.isArchived) tags.push('Keep/Archived');
		if (keepJson.isTrashed) tags.push('Keep/Deleted');
		if (keepJson.labels) {
			for (let label of keepJson.labels) {
				tags.push(`Keep/Label/${label.name}`);
			}
		}

		if (tags.length > 0) {
			frontMatter['tags'] = tags.map(tag => sanitizeTag(tag));
		}

		mdContent.push(serializeFrontMatter(frontMatter));

		// Actual content

		if (keepJson.textContent) {
			mdContent.push('\n');
			mdContent.push(sanitizeTags(keepJson.textContent));
		}

		if (keepJson.listContent) {
			let mdListContent = [];
			for (const listItem of keepJson.listContent) {
				// Don't put in blank checkbox items
				if (!listItem.text) continue;

				let listItemContent = `- [${listItem.isChecked ? 'X' : ' '}] ${listItem.text}`;
				mdListContent.push(sanitizeTags(listItemContent));
			}

			mdContent.push('\n\n');
			mdContent.push(mdListContent.join('\n'));
		}

		if (keepJson.attachments) {
			mdContent.push('\n\n');
			for (const attachment of keepJson.attachments) {
				mdContent.push(`![[${attachment.filePath}]]`);
			}
		}

		const noteText = mdContent.join('');
		const sanitizedName = sanitizeFileName(filename);
		const existingNotePath = normalizePath(`${folder.path}/${sanitizedName}.md`);
		const existingNote = this.vault.getAbstractFileByPath(existingNotePath) ?? this.vault.getAbstractFileByPathInsensitive(existingNotePath);

		let file: TFile;
		if (existingNote) {
			if (existingNote instanceof TFile) {
				if (this.existingFileBehavior === 'skip') {
					ctx.reportSkipped(sourcePath, 'Note already exists');
					return false;
				}
				if (this.existingFileBehavior === 'overwrite') {
					file = existingNote;
					await this.vault.modify(file, noteText);
				}
				else {
					file = await this.saveAsMarkdownFile(folder, filename, noteText);
				}
			}
			else {
				ctx.reportSkipped(sourcePath, 'Note path exists and is not a file');
				return false;
			}
		}
		else {
			file = await this.saveAsMarkdownFile(folder, filename, noteText);
		}

		// Modifying the creation and modified timestamps without changing file contents.
		if (createdMs !== undefined || editedMs !== undefined) {
			await this.vault.append(file, '', {
				ctime: createdMs,
				mtime: editedMs,
			});
		}

		return true;
	}
}
