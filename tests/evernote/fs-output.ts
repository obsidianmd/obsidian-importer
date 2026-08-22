import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { EvernoteOutput, FileTimes, PlacedAttachment } from '../../src/formats/evernote/output';
import { formatMarkdown } from '../../src/markdown-output';
import { i18n } from '../../src/i18n';
import { availableFileName, sanitizeFileName } from '../../src/util';

export type AttachmentLocation =
	| { mode: 'vault' }
	| { mode: 'folder', path: string }
	| { mode: 'note' }
	| { mode: 'subfolder', path: string };

export type Duplicates = 'copy' | 'skip' | 'update';

export interface Reporter {
	reportNoteSuccess(name: string): void;
	reportSkipped(name: string, reason?: string): void;
}

export interface FsOutputOptions {
	duplicates?: Duplicates;
	attachments?: AttachmentLocation;
	ctx?: Reporter;
}

export class FsOutput implements EvernoteOutput {
	private readonly duplicates: Duplicates;
	private readonly attachments: AttachmentLocation;

	private readonly claimed = new Set<string>();

	private readonly matched = new Set<string>();

	private readonly reportAs = new Map<string, string>();

	private readonly compareContent = new Set<string>();

	private readonly ctx: Reporter | undefined;

	constructor(
		private readonly root: string,
		{ duplicates = 'copy', attachments = { mode: 'subfolder', path: 'attachments' }, ctx }: FsOutputOptions = {},
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

	async planNote(folder: string, title: string, reportAs: string): Promise<string> {
		const name = `${sanitizeFileName(title, folder).replace(/\.md$/i, '')}.md`;
		const desired = `${folder}/${name}`;

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
			if (this.claimed.has(candidate)) continue;

			let existing: nodeFs.Stats;
			try {
				existing = nodeFs.statSync(candidate);
			}
			catch {
				this.claimed.add(candidate);
				return { path: candidate, write: true };
			}

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
