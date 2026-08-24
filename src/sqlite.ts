import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';

export type SQLiteValue = number | string | Uint8Array | null;
export type SQLiteRow = Record<string, SQLiteValue>;
export type SQLiteParameters = SQLiteValue[] | Record<string, SQLiteValue> | null;
export type SQLiteData = ArrayBuffer | Uint8Array;

export interface SQLiteAdapter<Result> {
	read(database: SQLiteDatabase): Result | Promise<Result>;
}

let sqlPromise: ReturnType<typeof initSqlJs> | undefined;

function sql() {
	return sqlPromise ??= initSqlJs();
}

/** An in-memory SQLite database that exposes typed, parameterized reads. */
export class SQLiteDatabase {
	private closed = false;

	constructor(private readonly database: Database) {}

	query<Row extends SQLiteRow = SQLiteRow>(
		query: string,
		parameters: SQLiteParameters = null,
	): Row[] {
		if (this.closed) throw new Error('SQLite database is closed.');

		const statement = this.database.prepare(query, parameters);
		try {
			const rows: Row[] = [];
			while (statement.step()) rows.push(statement.getAsObject() as Row);
			return rows;
		}
		finally {
			statement.free();
		}
	}

	close(): void {
		if (this.closed) return;
		this.database.close();
		this.closed = true;
	}
}

/** Open SQLite file bytes in memory. The caller owns and must close the result. */
export async function openSQLiteDatabase(data: SQLiteData): Promise<SQLiteDatabase> {
	const SQL = await sql();
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	return new SQLiteDatabase(new SQL.Database(bytes));
}

/** Open a database for a format adapter and always release it afterwards. */
export async function readSQLiteDatabase<Result>(
	data: SQLiteData,
	adapter: SQLiteAdapter<Result>,
): Promise<Result> {
	const database = await openSQLiteDatabase(data);
	try {
		return await adapter.read(database);
	}
	finally {
		database.close();
	}
}
