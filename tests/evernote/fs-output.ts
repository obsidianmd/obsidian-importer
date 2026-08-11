/**
 * A directory standing in for the vault, so a conversion can be recorded.
 *
 * The plugin writes an Evernote import through Vault; what these tests want is
 * a tree they can read back and compare with what is committed beside them.
 * Both are the same interface, which is what keeps the conversion itself free
 * of either.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { EvernoteOutput, FileTimes } from '../../src/formats/evernote/output';

export class FsOutput implements EvernoteOutput {
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

	async removeFolder(path: string): Promise<void> {
		nodeFs.rmSync(path, { recursive: true, force: true });
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
}
