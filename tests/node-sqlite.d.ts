/**
 * node:sqlite, which @types/node 20 predates.
 *
 * Only what the fixtures use: enough to build a notes database and read it
 * back. The plugin does not use it - it talks to the sqlite3 binary through
 * src/formats/apple-notes/sqlite.
 */
declare module 'node:sqlite' {
	interface StatementSync {
		run(...params: unknown[]): { changes: number, lastInsertRowid: number };
		all(...params: unknown[]): Record<string, unknown>[];
		get(...params: unknown[]): Record<string, unknown> | undefined;
	}

	export class DatabaseSync {
		constructor(path: string, options?: { readOnly?: boolean });
		exec(sql: string): void;
		prepare(sql: string): StatementSync;
		close(): void;
	}
}
