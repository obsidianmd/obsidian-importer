/**
 * Where an import puts what it converts.
 *
 * The conversion works out the paths; this is everything it has to ask about
 * what is at one already, and everything it has to do to put a file there. The
 * plugin answers with the vault, a test with a directory of its own, and
 * neither answer is anything the conversion knows about.
 *
 * Paths are as the conversion built them: separated by '/', below the output
 * folder it was given.
 */
export interface FileTimes {
	/** When the source says the file was created. */
	ctime?: number;
	/** When the source says it last changed. */
	mtime?: number;
}

export interface EvernoteOutput {
	/** Whether a file or a folder is at this path already. */
	exists(path: string): boolean;

	/** What is directly inside a folder, or nothing at all if it is not there. */
	list(folder: string): string[];

	/** When the file at this path was last written, or null if there is none. */
	writtenAt(path: string): number | null;

	/** Take a folder and everything under it, leaving the path free. */
	removeFolder(path: string): Promise<void>;

	/** Put a file there, over whatever the path holds, creating folders as needed. */
	write(path: string, data: string | ArrayBuffer, times: FileTimes): Promise<void>;
}
