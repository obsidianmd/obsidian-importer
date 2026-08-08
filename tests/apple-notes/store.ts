/**
 * A notes database to convert, built rather than captured.
 *
 * Apple Notes keeps a note as a gzipped protobuf inside a Core Data database,
 * so there is no export file to use as a fixture, and a real database is
 * somebody's private notes. This writes one instead: the same tables and the
 * same protobuf the importer reads, holding notes made up for the purpose.
 *
 * What that buys is a check on the conversion - every style, list, link and
 * attachment the converter handles, recorded as the markdown it produces. What
 * it cannot check is whether Apple still writes what this writes. Point the
 * test at a real database in local/ for that; see tests/helpers.ts.
 */
import * as nodeZlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

import { Root } from 'protobufjs';

import { descriptor } from '../../src/formats/apple-notes/descriptor';
import { ANAttachment, ANStyleType, SQLiteTagSpawned } from '../../src/formats/apple-notes/models';

/** The Core Data entities the importer looks up by name. */
const ENTITIES = ['ICAccount', 'ICFolder', 'ICNote', 'ICAttachment', 'ICMedia'];

/** Seconds between the Unix epoch and Apple's, which its timestamps count from. */
const CORETIME_OFFSET = 978307200;

export interface Run {
	text: string;
	style?: ANStyleType;
	/** Nesting depth for a list, as Apple counts it. */
	indent?: number;
	checked?: boolean;
	bold?: boolean;
	italic?: boolean;
	underlined?: boolean;
	strikethrough?: boolean;
	/** -1 subscript, 1 superscript. */
	baseline?: number;
	/** 0 left, 1 centre, 2 right, 3 justify. */
	alignment?: number;
	blockquote?: boolean;
	link?: string;
	color?: { red: number, green: number, blue: number, alpha: number };
	/** A highlight: 1 purple, 2 pink, 3 orange, 4 mint, 5 blue. */
	emphasis?: number;
	font?: { fontName?: string, pointSize?: number, fontHints?: number };
	/** An attachment stands in the text as one character. */
	attachment?: { identifier: string, uti: string };
}

export interface NoteSpec {
	title: string;
	runs: Run[];
	/**
	 * The note's zidentifier. Left out, it gets one of its own, which is what
	 * Apple does. Set to null for a note that carries none, so that what the
	 * importer falls back on can be tested.
	 */
	identifier?: string | null;
}

/** Something a note's text points at: an attachment row, or another note. */
export interface AttachmentSpec {
	identifier: string;
	uti: string;
	/** Shown for a hashtag or mention. */
	altText?: string;
	/** Title and URL of a link card. */
	title?: string;
	url?: string;
	/** The note an internal link points at. */
	tokenContentIdentifier?: string;
	/** A file on disk, which the importer would copy into the vault. */
	media?: number;
	/**
	 * Create a media row with this file name and point the attachment to it.
	 * Use `media` directly to reference a missing or separately defined row.
	 */
	mediaFilename?: string;
	/**
	 * Which note it hangs off, as an index into the spec's notes.
	 *
	 * The importer reads it to know whose account the file sits under, so an
	 * attachment it has to fetch needs one. By index because the primary keys
	 * are handed out here, and the spec is written before they exist.
	 */
	note?: number;
	/** A drawing's transcription. */
	handwriting?: string;
	/** A table or scan, as its own protobuf. */
	mergeableData?: Uint8Array;
	/**
	 * Directory containing a rendered drawing. Omitting this and `size` models
	 * a drawing that iCloud has not downloaded.
	 */
	fallbackImageGeneration?: string;
	size?: { width: number, height: number };
}

const root = Root.fromJSON(descriptor);
const Document = root.lookupType('ciofecaforensics.Document');

/** One note as the protobuf the database holds, gzipped as Apple stores it. */
export function encodeNote(note: NoteSpec): Buffer {
	let noteText = '';
	const attributeRun = [];

	for (const run of note.runs) {
		// An attachment occupies one character of the text, and the run that
		// covers it carries what it points at
		const text = run.attachment ? '￼' : run.text;
		noteText += text;

		const paragraphStyle: Record<string, unknown> = {};
		if (run.style !== undefined) paragraphStyle.styleType = run.style;
		if (run.indent !== undefined) paragraphStyle.indentAmount = run.indent;
		if (run.alignment !== undefined) paragraphStyle.alignment = run.alignment;
		if (run.blockquote) paragraphStyle.blockquote = 1;
		if (run.checked !== undefined) {
			paragraphStyle.checklist = { done: run.checked ? 1 : 0, uuid: new Uint8Array([1]) };
		}

		const fontWeight = run.bold && run.italic ? 3 : run.bold ? 1 : run.italic ? 2 : undefined;

		attributeRun.push({
			length: [...text].length,
			...(Object.keys(paragraphStyle).length > 0 ? { paragraphStyle } : {}),
			...(fontWeight !== undefined ? { fontWeight } : {}),
			...(run.underlined ? { underlined: 1 } : {}),
			...(run.strikethrough ? { strikethrough: 1 } : {}),
			...(run.baseline !== undefined ? { superscript: run.baseline } : {}),
			...(run.link ? { link: run.link } : {}),
			...(run.color ? { color: run.color } : {}),
			...(run.emphasis !== undefined ? { emphasisColor: run.emphasis } : {}),
			...(run.font ? { font: run.font } : {}),
			...(run.attachment
				? {
					attachmentInfo: {
						attachmentIdentifier: run.attachment.identifier,
						typeUti: run.attachment.uti,
					},
				}
				: {}),
		});
	}

	const message = Document.create({ version: 1, note: { noteText, attributeRun } });
	return nodeZlib.gzipSync(Buffer.from(Document.encode(message).finish()));
}

export interface StoreSpec {
	notes: NoteSpec[];
	attachments?: AttachmentSpec[];
}

/**
 * The tables the importer reads, with the columns it selects. Core Data names
 * them in upper case, and the importer reads the results back that way.
 */
const SCHEMA = `
	CREATE TABLE z_primarykey (Z_ENT INTEGER, Z_NAME TEXT);

	CREATE TABLE ziccloudsyncingobject (
		Z_PK INTEGER PRIMARY KEY,
		Z_ENT INTEGER,
		ZTITLE1 TEXT, ZTITLE2 TEXT, ZNAME TEXT,
		ZIDENTIFIER TEXT, ZALTTEXT TEXT, ZTOKENCONTENTIDENTIFIER TEXT,
		ZURLSTRING TEXT, ZTITLE TEXT,
		ZFOLDER INTEGER, ZFOLDERTYPE INTEGER, ZPARENT INTEGER, ZOWNER INTEGER,
		ZACCOUNT3 INTEGER, ZACCOUNT4 INTEGER, ZNOTE INTEGER, ZMEDIA INTEGER,
		ZMERGEABLEDATA1 BLOB, ZHANDWRITINGSUMMARY TEXT,
		ZFILENAME TEXT, ZTYPEUTI TEXT, ZIDENTIFIER1 TEXT,
		ZCREATIONDATE INTEGER, ZMODIFICATIONDATE INTEGER,
		ZCREATIONDATE1 INTEGER, ZMODIFICATIONDATE1 INTEGER,
		ZISPASSWORDPROTECTED INTEGER, ZMARKEDFORDELETION INTEGER,
		ZFALLBACKIMAGEGENERATION TEXT, ZSIZEWIDTH INTEGER, ZSIZEHEIGHT INTEGER
	);

	CREATE TABLE zicnotedata (
		Z_PK INTEGER PRIMARY KEY,
		ZNOTE INTEGER,
		ZDATA BLOB
	);
`;

export interface BuiltStore {
	database: SQLiteTagSpawned;
	/** Primary key of each note, in the order they were given. */
	notePks: number[];
	/** Primary key of the one folder every note is in, which owns the account. */
	folderPk: number;
	/** Each media row's directory and file name, for a test to write the file. */
	mediaFiles: [string, string][];
	close(): void;
}

/** Build the database at a path, and open it the way the importer would. */
export function buildStore(filepath: string, spec: StoreSpec): BuiltStore {
	const db = new DatabaseSync(filepath);
	db.exec(SCHEMA);

	const entity = Object.fromEntries(ENTITIES.map((name, i) => [name, i + 1]));
	const insertKey = db.prepare('INSERT INTO z_primarykey (z_ent, z_name) VALUES (?, ?)');
	for (const [name, id] of Object.entries(entity)) insertKey.run(id, name);

	const insertObject = db.prepare(`
		INSERT INTO ziccloudsyncingobject (
			Z_PK, Z_ENT, ZTITLE1, ZTITLE2, ZIDENTIFIER, ZALTTEXT, ZTOKENCONTENTIDENTIFIER,
			ZURLSTRING, ZTITLE, ZFOLDER, ZFOLDERTYPE, ZMEDIA, ZMERGEABLEDATA1,
			ZHANDWRITINGSUMMARY, ZCREATIONDATE1, ZMODIFICATIONDATE1
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	const insertData = db.prepare('INSERT INTO zicnotedata (Z_PK, ZNOTE, ZDATA) VALUES (?, ?, ?)');

	let pk = 1;
	const created = 700000000; // an Apple timestamp, so the dates are fixed

	// One account and one folder, which every note belongs to
	insertObject.run(pk++, entity.ICAccount, null, 'Test account', 'ACCOUNT-1', null, null, null, null, null, null, null, null, null, created, created);
	const folderPk = pk++;
	insertObject.run(folderPk, entity.ICFolder, null, 'Notes', 'FOLDER-1', null, null, null, null, null, 0, null, null, null, created, created);

	const notePks: number[] = [];
	for (const note of spec.notes) {
		const notePk = pk++;
		notePks.push(notePk);

		insertObject.run(notePk, entity.ICNote, note.title, null, note.identifier === undefined ? `NOTE-${notePk}` : note.identifier, null, null, null, null, folderPk, null, null, null, null, created, created);
		insertData.run(notePk, notePk, encodeNote(note));
	}

	// An attachment carries the columns the importer reads on its way to a file:
	// which note it hangs off, and the dates the copy in the vault is given
	const insertAttachment = db.prepare(`
		INSERT INTO ziccloudsyncingobject (
			Z_PK, Z_ENT, ZIDENTIFIER, ZALTTEXT, ZTOKENCONTENTIDENTIFIER,
			ZURLSTRING, ZTITLE, ZTYPEUTI, ZMEDIA, ZMERGEABLEDATA1,
			ZHANDWRITINGSUMMARY, ZNOTE, ZCREATIONDATE, ZMODIFICATIONDATE,
			ZFALLBACKIMAGEGENERATION, ZSIZEWIDTH, ZSIZEHEIGHT
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const mediaFiles: [string, string][] = [];

	const insertMedia = db.prepare(`
		INSERT INTO ziccloudsyncingobject (Z_PK, Z_ENT, ZIDENTIFIER, ZFILENAME)
		VALUES (?, ?, ?, ?)
	`);

	for (const attachment of spec.attachments ?? []) {
		let media = attachment.media ?? null;

		if (attachment.mediaFilename !== undefined) {
			media = pk++;
			insertMedia.run(media, entity.ICMedia, `MEDIA-${media}`, attachment.mediaFilename);
			mediaFiles.push([`MEDIA-${media}`, attachment.mediaFilename]);
		}

		insertAttachment.run(
			pk++, entity.ICAttachment, attachment.identifier,
			attachment.altText ?? null, attachment.tokenContentIdentifier ?? null,
			attachment.url ?? null, attachment.title ?? null, attachment.uti,
			media, attachment.mergeableData ?? null,
			attachment.handwriting ?? null,
			attachment.note === undefined ? null : notePks[attachment.note],
			created, created,
			attachment.fallbackImageGeneration ?? null,
			attachment.size?.width ?? 0, attachment.size?.height ?? 0);
	}

	return { database: tagged(db), notePks, folderPk, mediaFiles, close: () => db.close() };
}

/**
 * The database as the importer talks to it: a tagged template per query, with
 * the interpolated values passed as parameters.
 */
function tagged(db: DatabaseSync): SQLiteTagSpawned {
	const run = (strings: TemplateStringsArray, params: unknown[]) =>
		db.prepare(strings.join('?')).all(...params as never[]);

	return {
		get: async (strings: TemplateStringsArray, ...params: unknown[]) => run(strings, params)[0] as never,
		all: async (strings: TemplateStringsArray, ...params: unknown[]) => run(strings, params) as never,
		close: () => db.close(),
	} as unknown as SQLiteTagSpawned;
}

export { ANAttachment, ANStyleType, CORETIME_OFFSET };
