export interface FileTimes {
	ctime?: number;
	mtime?: number;
}

export interface PlacedAttachment {
	path: string;
	write: boolean;
}

export interface EvernoteOutput {
	planFolder(parent: string, name: string): string;

	/** `reportAs` includes the notebook for import reporting. */
	planNote(folder: string, title: string, reportAs: string): Promise<string>;

	willImport(path: string, sourceMtime?: number): boolean;

	writeNote(path: string, markdown: string, times: FileTimes): Promise<void>;

	/** Place according to vault settings; size identifies reusable files. */
	placeAttachment(fileName: string, notePath: string, size: number): Promise<PlacedAttachment>;

	linkTo(path: string, fromNote: string): string;

	writeAttachment(path: string, data: ArrayBuffer, times: FileTimes): Promise<void>;
}
