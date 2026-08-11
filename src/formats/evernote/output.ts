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
	/**
	 * Where a notebook of this name goes inside this folder, and take the path.
	 *
	 * An import bringing a notebook up to date wants the folder the last one
	 * made; one making a copy wants its own beside it. Which of those it is, and
	 * how a name already taken is numbered, is the same question planNote
	 * answers for a note - so it is answered in the same place.
	 */
	planFolder(parent: string, name: string): string;

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

	/** Put the note there, creating the folders on the way to it. */
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

	/** Put the attachment there, creating the folders on the way to it. */
	writeAttachment(path: string, data: ArrayBuffer, times: FileTimes): Promise<void>;
}
