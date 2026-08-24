import { readSQLiteDatabase } from '../../sqlite';
import type {
	SQLiteAdapter,
	SQLiteData,
	SQLiteRow,
	SQLiteValue,
} from '../../sqlite';

const CORE_DATA_EPOCH = 978_307_200;

export interface BearApplicationAttachment {
	id: string;
	filename: string;
}

export interface BearApplicationNote {
	key: number;
	id: string;
	title: string;
	text: string;
	ctime?: number;
	mtime?: number;
	archivedtime?: number;
	trashedtime?: number;
	encrypted: boolean;
	attachments: BearApplicationAttachment[];
}

type NoteRow = SQLiteRow & Record<
	'key' | 'id' | 'title' | 'text' | 'creation' | 'modification' |
	'archived' | 'archived_date' | 'trashed' | 'trashed_date' | 'encrypted',
	SQLiteValue
>;

type AttachmentRow = SQLiteRow & Record<'note_key' | 'id' | 'filename', SQLiteValue>;

function number(value: SQLiteValue): number {
	return typeof value === 'number' ? value : 0;
}

function string(value: SQLiteValue): string {
	return typeof value === 'string' ? value : '';
}

function coreDataTime(value: SQLiteValue): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return (value + CORE_DATA_EPOCH) * 1000;
}

/** Bear's adapter for the Core Data database in an iPhone/iPad export. */
export const bearApplicationDatabaseAdapter: SQLiteAdapter<BearApplicationNote[]> = {
	read(database) {
		const noteRows = database.query<NoteRow>(`
			SELECT
				Z_PK AS key,
				ZUNIQUEIDENTIFIER AS id,
				ZTITLE AS title,
				ZTEXT AS text,
				ZCREATIONDATE AS creation,
				ZMODIFICATIONDATE AS modification,
				ZARCHIVED AS archived,
				ZARCHIVEDDATE AS archived_date,
				ZTRASHED AS trashed,
				ZTRASHEDDATE AS trashed_date,
				ZENCRYPTED AS encrypted
			FROM ZSFNOTE
			WHERE COALESCE(ZPERMANENTLYDELETED, 0) = 0
			ORDER BY Z_PK
		`);

		const attachments = new Map<number, BearApplicationAttachment[]>();
		for (const row of database.query<AttachmentRow>(`
			SELECT ZNOTE AS note_key, ZUNIQUEIDENTIFIER AS id, ZFILENAME AS filename
			FROM ZSFNOTEFILE
			WHERE
				ZNOTE IS NOT NULL
				AND COALESCE(ZPERMANENTLYDELETED, 0) = 0
				AND COALESCE(ZUNUSED, 0) = 0
			ORDER BY Z_PK
		`)) {
			const noteKey = number(row.note_key);
			const id = string(row.id);
			const filename = string(row.filename);
			if (!noteKey || !id || !filename) continue;

			const noteAttachments = attachments.get(noteKey) ?? [];
			noteAttachments.push({ id, filename });
			attachments.set(noteKey, noteAttachments);
		}

		return noteRows.map(row => {
			const key = number(row.key);
			const archived = number(row.archived) !== 0;
			const trashed = number(row.trashed) !== 0;
			return {
				key,
				id: string(row.id),
				title: string(row.title),
				text: string(row.text),
				ctime: coreDataTime(row.creation),
				mtime: coreDataTime(row.modification),
				archivedtime: archived ? coreDataTime(row.archived_date) : undefined,
				trashedtime: trashed ? coreDataTime(row.trashed_date) : undefined,
				encrypted: number(row.encrypted) !== 0,
				attachments: attachments.get(key) ?? [],
			};
		});
	},
};

/** Read the Core Data database inside Bear's iPhone/iPad Application Data export. */
export function readBearApplicationDatabase(data: SQLiteData): Promise<BearApplicationNote[]> {
	return readSQLiteDatabase(data, bearApplicationDatabaseAdapter);
}

// A CommonMark destination may contain escaped characters or balanced
// parentheses. One balanced level covers Bear attachment filenames while
// keeping the rewrite scoped to actual Markdown links and images.
const MARKDOWN_LINK = /(\[[^\]\n]*\]\()((?:\\.|[^()\n]|\([^()\n]*\))+)(\))/g;

function decodedTarget(target: string): string {
	const unwrapped = target.startsWith('<') && target.endsWith('>')
		? target.slice(1, -1)
		: target;
	try {
		return decodeURI(unwrapped).normalize('NFC');
	}
	catch {
		return unwrapped.normalize('NFC');
	}
}

function encodedTarget(target: string): string {
	// encodeURI leaves parentheses literal, but the existing Bear converter
	// uses them to find the end of a Markdown destination.
	return encodeURI(target).replace(/[()]/g, character =>
		`%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

/**
 * Make Application Data attachment links look like the `assets/` links in a
 * .bear2bk textbundle, so the existing Bear Markdown conversion can resolve
 * both formats the same way. The attachment ID keeps duplicate names distinct.
 */
export function prepareBearApplicationMarkdown(note: BearApplicationNote): {
	content: string;
	assets: Map<string, BearApplicationAttachment>;
} {
	const parent = `${note.id}.textbundle`;
	const assets = new Map<string, BearApplicationAttachment>();
	const byTarget = new Map<string, { path: string, attachment: BearApplicationAttachment }>();

	for (const attachment of note.attachments) {
		const filename = attachment.filename.normalize('NFC');
		const id = attachment.id.normalize('NFC');
		const relative = `assets/${id}/${filename}`;
		const path = `${parent}/${relative}`;
		assets.set(path, attachment);
		byTarget.set(filename, { path: relative, attachment });
		byTarget.set(`${id}/${filename}`, { path: relative, attachment });
	}

	const content = note.text.replace(MARKDOWN_LINK, (match, opening: string, target: string, closing: string) => {
		const found = byTarget.get(decodedTarget(target));
		if (!found) return match;

		return `${opening}${encodedTarget(found.path)}${closing}`;
	});

	return { content, assets };
}
