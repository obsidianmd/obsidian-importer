/**
 * Where an import puts what it converts.
 *
 * The conversion decides what a note is called and what it says; everything
 * about where it lands - the name a note takes when one like it is there, the
 * folder an attachment belongs in, whether a note is being written at all - is
 * asked here. The plugin answers with FormatImporter and the vault, a test
 * with a directory of its own, and neither answer is anything the conversion
 * knows about.
 *
 * A plan is referred to by the path it settled on. What else the output needs
 * to remember about it is the output's business.
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

/** Where an attachment goes, and whether it has to be written at all. */
export interface PlacedAttachment {
	path: string;
	/** False when the file there is this attachment already. */
	write: boolean;
}

export interface EvernoteOutput {
	/** Whether a file or a folder is at this path already. */
	exists(path: string): boolean;

	/**
	 * Whether this import is making a copy of what it finds rather than
	 * bringing it up to date. It is what decides between importing a notebook
	 * into the folder an earlier import made and putting a new one beside it.
	 */
	makesCopies(): boolean;

	/**
	 * Where a note of this title goes in this folder, and take the path.
	 *
	 * `reportAs` is the name the note is known by in what the import reports,
	 * which for Evernote carries its notebook and so is not the file name.
	 */
	planNote(folder: string, title: string, reportAs: string): string;

	/**
	 * Whether the note planned at this path is being imported at all, given
	 * when its source last changed. Answering no reports why.
	 */
	willImport(path: string, sourceMtime?: number): boolean;

	writeNote(path: string, markdown: string, times: FileTimes): Promise<void>;

	/**
	 * Where an attachment of this name, belonging to this note, goes.
	 *
	 * Whoever answers decides the folder - which in the vault is the user's
	 * attachment setting - and what to do about a name already taken. The size
	 * is offered because it is all there is to tell this attachment from
	 * another one arriving under the same name.
	 */
	placeAttachment(fileName: string, notePath: string, size: number): Promise<PlacedAttachment>;

	/** How a note at one path refers to a file at another. */
	linkTo(path: string, fromNote: string): string;

	writeAttachment(path: string, data: ArrayBuffer, times: FileTimes): Promise<void>;
}
