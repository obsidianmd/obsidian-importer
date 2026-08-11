/**
 * A directory standing in for the vault, so a conversion can be recorded.
 *
 * The plugin writes an Evernote import through Vault; what these tests want is
 * a tree they can read back and compare with what is committed beside them.
 * Both are the same interface, which is what keeps the conversion itself free
 * of either.
 *
 * Attachments go where the vault's "default location for new attachments"
 * setting would put them. The recordings are made with a subfolder called
 * _resources beside the note, which is what an Evernote import used to do
 * whatever the vault said, so the trees stay readable next to what they
 * replaced. What the plugin does is whatever the user has set.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { EvernoteOutput, FileTimes, PlacedAttachment } from '../../src/formats/evernote/output';

/** The four shapes Obsidian's attachmentFolderPath setting takes. */
export type AttachmentLocation =
	| { mode: 'vault' }
	| { mode: 'folder', path: string }
	| { mode: 'note' }
	| { mode: 'subfolder', path: string };

export class FsOutput implements EvernoteOutput {
	/** Attachment paths this import has given out. */
	private readonly claimed = new Set<string>();

	constructor(
		/** Where the output folder is, which is what a vault path is relative to. */
		private readonly root: string,
		private readonly attachments: AttachmentLocation = { mode: 'subfolder', path: '_resources' },
	) { }

	exists(path: string): boolean {
		return nodeFs.existsSync(path);
	}

	list(folder: string): string[] {
		try {
			return nodeFs.readdirSync(folder);
		}
		catch {
			return [];
		}
	}

	writtenAt(path: string): number | null {
		try {
			return nodeFs.statSync(path).mtimeMs;
		}
		catch {
			return null;
		}
	}

	async placeAttachment(fileName: string, notePath: string, size: number): Promise<PlacedAttachment> {
		const folder = this.attachmentFolder(notePath);
		const { name, extension } = split(fileName);

		for (let nth = 0; ; nth++) {
			const candidate = `${folder}/${name}${nth ? ` ${nth}` : ''}${extension}`;
			// A path this import has already given out belongs to that attachment,
			// however alike the two look. Vault.placeAttachment does the same.
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

	async write(path: string, data: string | ArrayBuffer, times: FileTimes): Promise<void> {
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
