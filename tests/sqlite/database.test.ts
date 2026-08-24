import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import initSqlJs from 'sql.js';

import { openSQLiteDatabase, readSQLiteDatabase } from '../../src/sqlite';
import type {
	SQLiteAdapter,
	SQLiteDatabase,
	SQLiteRow,
} from '../../src/sqlite';

interface ExampleRow extends SQLiteRow {
	id: number;
	name: string;
	payload: Uint8Array | null;
}

async function exampleDatabase(): Promise<Uint8Array> {
	const SQL = await initSqlJs();
	const database = new SQL.Database();
	try {
		database.run('CREATE TABLE examples (id INTEGER PRIMARY KEY, name TEXT, payload BLOB)');
		database.run('INSERT INTO examples VALUES (?, ?, ?)', [1, 'one', new Uint8Array([1, 2, 3])]);
		database.run('INSERT INTO examples VALUES (?, ?, ?)', [2, 'two', null]);
		return database.export();
	}
	finally {
		database.close();
	}
}

test('executes typed, parameterized SQLite queries', async () => {
	const database = await openSQLiteDatabase(await exampleDatabase());
	try {
		const rows = database.query<ExampleRow>(
			'SELECT id, name, payload FROM examples WHERE id >= :minimum ORDER BY id',
			{ ':minimum': 2 },
		);

		assert.deepEqual(rows, [{ id: 2, name: 'two', payload: null }]);
	}
	finally {
		database.close();
	}
});

test('format adapters always close their SQLite database', async () => {
	let opened!: SQLiteDatabase;
	const adapter: SQLiteAdapter<ExampleRow[]> = {
		read(database) {
			opened = database;
			return database.query<ExampleRow>('SELECT id, name, payload FROM examples ORDER BY id');
		},
	};

	const rows = await readSQLiteDatabase(await exampleDatabase(), adapter);

	assert.equal(rows.length, 2);
	assert.throws(() => opened.query('SELECT 1'), /database is closed/i);
});

test('format adapters close their SQLite database after a failure', async () => {
	let opened!: SQLiteDatabase;
	const adapter: SQLiteAdapter<never> = {
		read(database) {
			opened = database;
			throw new Error('adapter failed');
		},
	};

	await assert.rejects(readSQLiteDatabase(await exampleDatabase(), adapter), /adapter failed/);
	assert.throws(() => opened.query('SELECT 1'), /database is closed/i);
});
