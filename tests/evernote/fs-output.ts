/**
 * A directory standing in for the vault, so a conversion can be recorded.
 *
 * The plugin answers the conversion with FormatImporter and the vault; what
 * these tests want is a tree they can read back and compare with what is
 * committed beside them. Both are the same interface, which is what keeps the
 * conversion itself free of either.
 *
 * The policies are the vault's, reimplemented rather than reached for: a note
 * name already taken is numbered " 1", " 2" the way availableFileName does,
 * and a note matched by an earlier import is left, updated or preserved by
 * comparing its modification time with the source's, the way comparedToSource
 * does. Where they disagree with FormatImporter, this is wrong.
 *
 * Attachments go where the vault's "default location for new attachments"
 * setting would put them. The recordings are made with a subfolder called
 * _resources beside the note, so the trees stay readable next to the ones they
 * replaced. What the plugin does is whatever the user has set.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { EvernoteOutput, FileTimes, PlacedAttachment } from '../../src/formats/evernote/output';
import { formatMarkdown } from '../../src/markdown-output';
import { i18n } from '../../src/i18n';
import { availableFileName, sanitizeFileName } from '../../src/util';

/** The four shapes Obsidian's attachmentFolderPath setting takes. */
export type AttachmentLocation =
	| { mode: 'vault' }
	| { mode: 'folder', path: string }
	| { mode: 'note' }
	| { mode: 'subfolder', path: string };

/** Stands in for the importer's "Existing notes" setting. */
export type Duplicates = 'copy' | 'skip' | 'update';

/** What the import is told about each note, as FormatImporter tells it. */
export interface Reporter {
	reportNoteSuccess(name: string): void;
	reportSkipped(name: string, reason?: string): void;
}

export interface FsOutputOptions {
	duplicates?: Duplicates;
	attachments?: AttachmentLocation;
	/** Where the reason a note was left alone goes, as it does in the plugin. */
	ctx?: Reporter;
}

export class FsOutput implements EvernoteOutput {
	private readonly duplicates: Duplicates;
	private readonly attachments: AttachmentLocation;

	/** Paths this import has given out, note and attachment alike. */
	private readonly claimed = new Set<string>();

	/** Planned paths where an earlier import's note is already sitting. */
	private readonly matched = new Set<string>();

	/** How each planned note is named in what the import reports. */
	private readonly reportAs = new Map<string, string>();

	/**
	 * Notes whose fate cannot be settled until their markdown exists, because
	 * the export gave no modification time to compare. writePlannedNote does
	 * the same: it is the answer preflightNote calls "compare-content".
	 */
	private readonly compareContent = new Set<string>();

	private readonly ctx: Reporter | undefined;

	constructor(
		/** Where the output folder is, which is what a vault path is relative to. */
		private readonly root: string,
		{ duplicates = 'copy', attachments = { mode: 'subfolder', path: '_resources' }, ctx }: FsOutputOptions = {},
	) {
		this.duplicates = duplicates;
		this.attachments = attachments;
		this.ctx = ctx;
	}

	planFolder(parent: string, name: string): string {
		const taken = (candidate: string) => this.claimed.has(`${parent}/${candidate}`)
			|| nodeFs.existsSync(`${parent}/${candidate}`);

		const folder = `${parent}/${this.duplicates === 'copy' ? availableFileName(name, taken) : name}`;
		this.claimed.add(folder);

		return folder;
	}

	planNote(folder: string, title: string, reportAs: string): string {
		const name = `${sanitizeFileName(title, folder).replace(/\.md$/i, '')}.md`;
		const desired = `${folder}/${name}`;

		// An earlier import's note is written to again rather than beside.
		if (this.duplicates !== 'copy' && !this.claimed.has(desired) && nodeFs.existsSync(desired)) {
			this.claimed.add(desired);
			this.matched.add(desired);
			this.reportAs.set(desired, reportAs);

			return desired;
		}

		const free = `${folder}/${availableFileName(name, candidate =>
			this.claimed.has(`${folder}/${candidate}`) || nodeFs.existsSync(`${folder}/${candidate}`))}`;
		this.claimed.add(free);
		this.reportAs.set(free, reportAs);

		return free;
	}

	willImport(path: string, sourceMtime?: number): boolean {
		if (!this.matched.has(path)) return true;

		if (this.duplicates === 'skip') return this.leave(path, i18n.reason.alreadyInVault());

		// Nothing can be decided until the markdown exists, so the note is
		// converted and the text compared at the write.
		if (sourceMtime === undefined) {
			this.compareContent.add(path);
			return true;
		}

		const writtenAt = Math.round(nodeFs.statSync(path).mtimeMs);
		if (writtenAt === sourceMtime) return this.leave(path, i18n.reason.unchangedSinceImport());
		if (writtenAt > sourceMtime) return this.leave(path, i18n.reason.editedSinceImport());

		return true;
	}

	async writeNote(path: string, markdown: string, times: FileTimes): Promise<void> {
		// The vault formats a note as it writes it, in createMarkdown - so this
		// is what the recordings are of, and what an unchanged note has to be
		// compared against. unchangedContent compares the formatted form too.
		const content = formatMarkdown(markdown, { indentUnit: '    ' });

		if (this.compareContent.has(path) && nodeFs.readFileSync(path, 'utf8') === content) {
			this.leave(path, i18n.reason.unchangedSinceImport());
			return;
		}

		await this.write(path, content, times);
		this.ctx?.reportNoteSuccess(this.reportAs.get(path) ?? path);
	}

	async placeAttachment(fileName: string, notePath: string, size: number): Promise<PlacedAttachment> {
		const folder = this.attachmentFolder(notePath);
		const { name, extension } = split(fileName);

		for (let nth = 0; ; nth++) {
			const candidate = `${folder}/${name}${nth ? ` ${nth}` : ''}${extension}`;
			// A path this import has already given out belongs to whatever took
			// it, however alike the two look. placeAttachment does the same.
			if (this.claimed.has(candidate)) continue;

			let existing: nodeFs.Stats;
			try {
				existing = nodeFs.statSync(candidate);
			}
			catch {
				this.claimed.add(candidate);
				return { path: candidate, write: true };
			}

			// The same name holding the same bytes is taken to be this one again.
			if (existing.size !== size) continue;

			this.claimed.add(candidate);
			return { path: candidate, write: false };
		}
	}

	linkTo(path: string): string {
		return nodePath.relative(this.root, path).split(nodePath.sep).join('/');
	}

	async writeAttachment(path: string, data: ArrayBuffer, times: FileTimes): Promise<void> {
		await this.write(path, data, times);
	}

	private async write(path: string, data: string | ArrayBuffer, times: FileTimes): Promise<void> {
		nodeFs.mkdirSync(nodePath.dirname(path), { recursive: true });
		nodeFs.writeFileSync(path, typeof data === 'string' ? data : Buffer.from(data));

		if (times.mtime === undefined) return;
		try {
			const seconds = times.mtime / 1000;
			nodeFs.utimesSync(path, seconds, seconds);
		}
		catch {
			// The file is written; its timestamps are best effort.
		}
	}

	private leave(path: string, reason: string): false {
		this.ctx?.reportSkipped(this.reportAs.get(path) ?? path, reason);

		return false;
	}

	private attachmentFolder(notePath: string): string {
		const noteFolder = notePath.slice(0, notePath.lastIndexOf('/'));

		switch (this.attachments.mode) {
			case 'vault': return this.root;
			case 'folder': return `${this.root}/${this.attachments.path}`;
			case 'note': return noteFolder;
			case 'subfolder': return `${noteFolder}/${this.attachments.path}`;
		}
	}
}

function split(fileName: string): { name: string, extension: string } {
	const dot = fileName.lastIndexOf('.');

	return dot <= 0
		? { name: fileName, extension: '' }
		: { name: fileName.slice(0, dot), extension: fileName.slice(dot) };
}
