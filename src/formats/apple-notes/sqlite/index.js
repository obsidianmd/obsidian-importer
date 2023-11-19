import { Platform } from 'obsidian';
import { os, path } from '../../../filesystem';
import { supportsJson, sqlToJson } from './fallback';
import { error, raw, sql } from './utils.js';

export const crypto = Platform.isDesktopApp ? window.require('node:crypto') : null;
export const child_process = Platform.isDesktopApp ? window.require('node:child_process') : null;

const UNIQUE_ID = crypto?.randomUUID();
const UNIQUE_ID_LINE_JSON = `[{"_":"${UNIQUE_ID}"}]\n`;
const UNIQUE_ID_LINE_SQL = `'_'\n'${UNIQUE_ID}'\n`;

const { isArray } = Array;
const { parse } = JSON;
const { defineProperty } = Object;

const noop = () => {};

const defaultExec = (res, rej, type, bin, args, opts) => {
	const out = [];

	const {
		stdout,
		stderr
	} = child_process.spawn(bin, args, opts).on(
		'close',
		code => {
			if (errored || code !== 0) {
				if (code !== 0) error(rej, 'busy DB or query too slow');
				return;
			}

			const result = out.join('').trim();
			if (type === 'query') res(result);
			else {
				const json = parse(result || '[]');
				res(type === 'get' && isArray(json) ? json.shift() : json);
			}
		}
	);

	stdout.on('data', data => {
		out.push(data);
	});

	let errored = false;
	stderr.on('data', data => {
		errored = true;
		error(rej, ''.trim.call(data));
	});
};

const interactiveExec = (bin, args, timeout) => {
	const hasJson = supportsJson(bin);
	const uniqueIdLine = hasJson ? UNIQUE_ID_LINE_JSON : UNIQUE_ID_LINE_SQL;
	
	const { stdin, stdout, stderr } = child_process.spawn(bin, args);
	if (hasJson) stdin.write('.mode json\n');
	else stdin.write(`.mode quote\n.headers on\n`);

	if (timeout) stdin.write(`.timeout ${timeout}\n`);
	let next = Promise.resolve();
	
	return (res, rej, type, _, args) => {
		if (type === 'close') {
			stdin.write('.quit\n');
			next = null;
		} 
		else if (next) {
			next = next.then(
				() => new Promise(done => {
					let out = '';
					
					const $ = data => {
						out += data;
						let process = false;
						
						while (out.endsWith(uniqueIdLine)) {
							process = true;
							out = out.slice(0, -uniqueIdLine.length);
						}
						
						if (process) {
							dropListeners();
							// this one is funny *but* apparently possible
							/* c8 ignore next 2 */
							while (out.startsWith(uniqueIdLine)) out = out.slice(uniqueIdLine.length);

							if (type === 'query') res(out);
							else {
								const json = hasJson ? parse(out || '[]') : sqlToJson(out);
								res(type === 'get' ? json.shift() : json);
							}
						}
					};
					
					const _ = data => {
						dropListeners();
						rej(new Error(data));
					};
					
					const dropListeners = () => {
						done();
						stdout.removeListener('data', $);
						stderr.removeListener('data', _);
					};
					
					stdout.on('data', $);
					stderr.once('data', _);
					stdin.write(`${args[args.length - 1]};\n`);
					stdin.write(`SELECT '${UNIQUE_ID}' as _;\n`);
				})
			);
		}
	};
};

/**
 * Returns a template literal tag function usable to await `get`, `all`, or
 * `query` SQL statements. The tag will return a Promise with results.
 * In case of `all`, an Array is always resolved, if no error occurs, while with
 * `get` the result or undefined is returned instead. The `query` returns whatever
 * output the spawned command produced.
 * @param {string} type the query type
 * @param {string} bin the sqlite3 executable
 * @param {function} exec the logic to spawn and parse the output
 * @param {string[]} args spawned arguments for sqlite3
 * @param {object} opts spawned options
 * @returns {function}
 */
const sqlite = (type, bin, exec, args, opts) => (..._) => new Promise((res, rej) => {
	let query = sql(rej, _);
	if (!query.length) return;
	
	if (
		type === 'get' &&
		/^SELECT\s+/i.test(query) &&
		!/\s+LIMIT\s+\d+$/i.test(query)
	) {
		query += ' LIMIT 1';
	}
	exec(res, rej, type, bin, args.concat(query), opts);
});

let memory = '';

/**
 * @typedef {object} SQLiteOptions optional options
 * @property {boolean?} readonly opens the database in readonly mode
 * @property {string?} bin the sqlite3 executable path
 * @property {number?} timeout optional db/spawn timeout in milliseconds
 * @property {boolean} [persistent=false] optional flag to keep the db persistent
 * @property {function} [exec=defaultExec] the logic to spawn and parse the output
 */

/**
 * Returns `all`, `get`, `query`, and `raw` template literal tag utilities,
 * plus a `transaction` one that, once invoked, returns also a template literal
 * tag utility with a special `.commit()` method, to execute all queries used
 * within such returned tag function.
 * @param {string} db the database file to create or `:memory:` for a temp file
 * @param {SQLiteOptions?} options optional extra options
 * @returns 
 */
export default function SQLiteTag(db, options = {}) {
	if (db === ':memory:') db = memory || (memory = path.join(os.tmpdir(), randomUUID()));

	const timeout = options.timeout || 0;
	const bin = options.bin || 'sqlite3';

	const args = [db, '-bail'];
	const opts = {
		timeout
	};

	if (options.readonly) args.push('-readonly');

	if (timeout) args.push('-cmd', '.timeout ' + timeout);

	const json = args.concat('-json');
	const exec = options.exec || (
		options.persistent ?
			interactiveExec(bin, args, timeout) :
			defaultExec
	);

	return {
		/**
		 * Returns a template literal tag function where all queries part of the
		 * transactions should be written, and awaited through `tag.commit()`.
		 * @returns {function}
		 */
		transaction() {
			const params = [];
			return defineProperty(
				(..._) => {
					params.push(_);
				},
				'commit', {
					value() {
						return new Promise((res, rej) => {
							const multi = ['BEGIN TRANSACTION'];
							for (const _ of params) {
								const query = sql(rej, _);
								if (!query.length) return;
								multi.push(query);
							}
							multi.push('COMMIT');
							exec(res, rej, 'query', bin, args.concat(multi.join(';')), opts);
						});
					}
				}
			);
		},
		query: sqlite('query', bin, exec, args, opts),
		get: sqlite('get', bin, exec, json, opts),
		all: sqlite('all', bin, exec, json, opts),
		close: options.persistent ? (() => exec(null, null, 'close')) : noop,
		raw
	};
};
