import { child_process } from './index.js';

export const supportsJson = (bin) => {
	const out = child_process.execSync(`${bin} --version`).toString();
	const version = out.toString().match(/(\d+)\.(\d+).(\d+)/);
	
	return version?.[1] > 3 || version?.[2] > 32;
};

export const sqlToJson = (sql) => {
	let json = [];
	if (!sql) return json;
	
	const columnNames = [];
	let i = 0;
	let columnPos = -1;
	let row = {};
	
	while (i < sql.length) {
		let token = '';
		
		if (sql[i] === '\'') {
			// String/hex-encoded blob
			i++;
						
			while (i < sql.length) {
				if (sql[i] !== '\'') {
					// Not quote
					const offset = sql.indexOf('\'', i);
					token += sql.substring(i, offset);
					i = offset;
				}
				else if (sql[i + 1] === '\'') {
					// Escaped quote ('')
					token += sql[i];
					i += 2;
				}
				else {
					// Closing quote
					i++;
					break;
				}
			}
		}
		else if (sql[i] === 'N') { 
			// Null
			token = null;
			i += 4;
		}
		else { 
			// Number
			let offset = Math.min(
				...[sql.indexOf(',', i), sql.indexOf('\n', i)].filter(a => a > 0),
				sql.length - 1
			);
			
			token = parseFloat(sql.substring(i, offset));
			i = offset;
		}
		
		if (columnPos == -1) columnNames.push(token);
		else {
			row[columnNames[columnPos]] = token;
			columnPos++;
		}
		
		if (sql[i] == '\n' || columnNames.length < columnPos) {
			if (columnPos !== -1) json.push(row);
			columnPos = 0;
			row = {};
		}
		
		i++;
	}
	
	return json;
};
