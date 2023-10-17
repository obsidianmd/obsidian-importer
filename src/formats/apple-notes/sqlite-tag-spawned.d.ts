declare module 'sqlite-tag-spawned' {
	export default class SQLiteTagSpawned {
		constructor(path: string, options?: Record<string, boolean>);
		get(...query: any[]): Promise<SQLiteRow>;
		all(...query: any[]): Promise<SQLiteTable>;
		
		version: number;
	} 
	
	type SQLiteTable = SQLiteRow[];
	
	interface SQLiteRow extends Record<string, any> {
		[member: string]: any;
	}
}
