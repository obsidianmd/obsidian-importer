import { App, TAbstractFile, TFile, TFolder, Vault } from 'obsidian';

import { EvernoteOutput, FileTimes, PlacedAttachment } from './output';

/**
 * The vault, answering for an Evernote import.
 *
 * The conversion works in whole paths below the vault root, which is what
 * Vault takes, so nothing here translates: it looks a path up, and writes to
 * it. What it does add is the folders - Vault will not create a file inside
 * one that is not there, and the conversion never says "make this folder",
 * only "put this here".
 */
export class VaultOutput implements EvernoteOutput {
	private readonly vault: Vault;

	constructor(
		private readonly app: App,
		/** Told about every note written, so the importer can finish with it. */
		private readonly wrote: (file: TFile) => void,
		/**
		 * FormatImporter.placeAttachment, which is protected, so the importer
		 * hands it over rather than this reaching for it. It is what applies the
		 * vault's attachment setting and what decides about a name already taken.
		 */
		private readonly place: (fileName: string, notePath: string, size: number) => Promise<PlacedAttachment>,
	) {
		this.vault = app.vault;
	}

	async placeAttachment(fileName: string, notePath: string, size: number): Promise<PlacedAttachment> {
		return await this.place(fileName, notePath, size);
	}

	/**
	 * The whole path, which is a link Obsidian resolves from anywhere.
	 * finalizeMarkdownOutput shortens it afterwards, to whatever the user set.
	 */
	linkTo(path: string): string {
		return path;
	}

	exists(path: string): boolean {
		return this.vault.getAbstractFileByPathInsensitive(path) !== null;
	}

	list(folder: string): string[] {
		const found = this.vault.getAbstractFileByPathInsensitive(folder);

		return found instanceof TFolder ? found.children.map(child => child.name) : [];
	}

	writtenAt(path: string): number | null {
		const found = this.vault.getAbstractFileByPath(path);

		return found instanceof TFile ? found.stat.mtime : null;
	}

	async removeFolder(path: string): Promise<void> {
		const found = this.vault.getAbstractFileByPathInsensitive(path);
		// Trashed rather than deleted: a re-import empties a note's attachment
		// folder, and what was in it may not all have been ours.
		if (found instanceof TFolder) await this.app.fileManager.trashFile(found);
	}

	async write(path: string, data: string | ArrayBuffer, times: FileTimes): Promise<void> {
		await this.createFolders(path.slice(0, path.lastIndexOf('/')));

		const existing = this.vault.getAbstractFileByPath(path);
		const file = existing instanceof TFile
			? await this.overwrite(existing, data, times)
			: await this.create(path, data, times);

		if (path.toLowerCase().endsWith('.md')) this.wrote(file);
	}

	private async create(path: string, data: string | ArrayBuffer, times: FileTimes): Promise<TFile> {
		return typeof data === 'string'
			? await this.vault.create(path, data, times)
			: await this.vault.createBinary(path, data, times);
	}

	private async overwrite(file: TFile, data: string | ArrayBuffer, times: FileTimes): Promise<TFile> {
		if (typeof data === 'string') await this.vault.modify(file, data, times);
		else await this.vault.modifyBinary(file, data, times);

		return file;
	}

	/** Every folder down to this one, skipping the ones already there. */
	private async createFolders(path: string): Promise<void> {
		let sofar = '';
		for (const segment of path.split('/')) {
			sofar = sofar ? `${sofar}/${segment}` : segment;
			if (this.folderAt(sofar)) continue;

			await this.vault.createFolder(sofar);
		}
	}

	private folderAt(path: string): TAbstractFile | null {
		const found = this.vault.getAbstractFileByPathInsensitive(path);

		return found instanceof TFolder ? found : null;
	}
}
