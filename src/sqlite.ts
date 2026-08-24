import initSqlJs from 'sql.js';
import type { Database, SqlJsConfig, SqlJsStatic } from 'sql.js';

export type SQLiteValue = number | string | Uint8Array | null;
export type SQLiteRow = Record<string, SQLiteValue>;
export type SQLiteParameters = SQLiteValue[] | Record<string, SQLiteValue> | null;
export type SQLiteData = ArrayBuffer | Uint8Array;
export type SQLiteInitializer = (config?: SqlJsConfig) => Promise<SqlJsStatic>;

export interface SQLiteAdapter<Result> {
	read(database: SQLiteDatabase): Result | Promise<Result>;
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

/** Owns a retryable sql.js initialization and opens databases with it. */
export class SQLiteFactory {
	private sqlPromise: ReturnType<typeof initSqlJs> | undefined;

	constructor(private readonly initialize: SQLiteInitializer = initSqlJs) {}

	private sql(): ReturnType<typeof initSqlJs> {
		if (this.sqlPromise) return this.sqlPromise;

		const loading = this.initialize().catch(error => {
			if (this.sqlPromise === loading) this.sqlPromise = undefined;
			throw error;
		});
		this.sqlPromise = loading;
		return this.sqlPromise;
	}

	async open(data: SQLiteData): Promise<SQLiteDatabase> {
		const SQL = await this.sql();
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		return new SQLiteDatabase(new SQL.Database(bytes));
	}
}

const sqlite = new SQLiteFactory();

/** Open SQLite file bytes in memory. The caller owns and must close the result. */
export async function openSQLiteDatabase(data: SQLiteData): Promise<SQLiteDatabase> {
	return await sqlite.open(data);
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
