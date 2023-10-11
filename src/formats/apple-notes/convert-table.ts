import { 
	ANMergeableDataObject, ANTableObject,
	ANTableKey, ANTableType, ANTableUuidMapping, 
} from './models';
import { NoteConverter } from './convert-note';
import { AppleNotesImporter } from '../apple-notes';


export class TableConverter {
	importer: AppleNotesImporter;
	table: ANMergeableDataObject;
	
	//Apple Notes uses CRDTs to allow multiple people to work on a note at once.
	//Therefore, everything is stored as references with heaps of indirection instead of directly
	
	//These are used as keys for objects to reference another, by offset in these lists
	//eg a type is stored as 9 which means whatever's in types[9]
	keys: ANTableKey[];
	types: ANTableType[];
	uuids: string[];
	
	//This is used to store the actual data
	objects: ANTableObject[];
	
	rowCount: number;
	rowLocations: ANTableUuidMapping = {};
	
	columnCount: number;
	columnLocations: ANTableUuidMapping = {};
	
	constructor(importer: AppleNotesImporter, table: ANMergeableDataObject) {
		this.importer = importer;
		this.table = table;
		
		const data = table.mergeableDataObjectData;
		
		this.keys = data.mergeableDataObjectKeyItem; 
		this.types = data.mergeableDataObjectTypeItem;
		this.uuids = data.mergeableDataObjectUuidItem.map(this.uuidToString);
		this.objects = data.mergeableDataObjectEntry;
	}
	
	async parse(): Promise<string[][] | null> {		
		// We want to find the root table object first
		const root = this.objects.find(e => e.customMap && this.types[e.customMap.type] == ANTableType.ICTable);
		if (!root) return null;
	
		let cellData: ANTableObject | null = null;
		
		//The root contains references which lead to the row locations, column locations, or actual cell data
		for (const entry of root.customMap.mapEntry) {
			const object = this.objects[entry.value.objectIndex];
			
			switch (this.keys[entry.key]) {
				case ANTableKey.Rows:
					[this.rowLocations, this.rowCount] = this.findLocations(object);
					break;
				
				case ANTableKey.Columns:
					[this.columnLocations, this.columnCount] = this.findLocations(object);
					break;
				
				case ANTableKey.CellColumns:
					cellData = object;
					break;
			}
		}
		
		if (!cellData) return null;
		return await this.computeCells(cellData);
	}
	
	/** Compute the location of the rows/columns, 
	returning a mapping of the row/col uuid to its location in the table, and the total row/col amount */
	findLocations(object: ANTableObject): [ANTableUuidMapping, number] {
		let ordering: string[] = [];
		let indices: ANTableUuidMapping = {};
		
		for (let element of object.orderedSet.ordering.array.attachment) {
			ordering.push(this.uuidToString(element.uuid));
		}
		
		for (let element of object.orderedSet.ordering.contents.element) {
			let key = this.getTargetUuid(element.key.objectIndex);
			let value = this.getTargetUuid(element.value.objectIndex);
			
			indices[value] = ordering.indexOf(key);
		}
		
		return [indices, ordering.length];
	}
	
	/** Use the computed indices to build a table array and format each cell */
	async computeCells(cellData: ANTableObject): Promise<string[][]> {
		//fill the array to the table dimensions
		let result = Array(this.rowCount).fill(0).map(() => Array(this.columnCount));
		
		//put the values in the table	
		for (let column of cellData.dictionary.element) {
			let columnUuid = this.getTargetUuid(column.key.objectIndex);
			let rowData = this.objects[column.value.objectIndex];
			
			for (let row of rowData.dictionary.element) {
				let rowUuid = this.getTargetUuid(row.key.objectIndex);
				let rowContent = this.objects[row.value.objectIndex];
				
				const converter = new NoteConverter(this.importer, rowContent.note);
				result[this.rowLocations[rowUuid]][this.columnLocations[columnUuid]] = await converter.format(true); 
			}
		}
		
		return result;
	}
	
	/** Convert the table array into a markdown table */
	async format(): Promise<string> {
		let table = await this.parse();		
		if (!table) return '';
		
		let converted = '\n';
		
		for (let i = 0; i < table.length; i++) {
			converted += table[i].join(' | ') + '\n';
			if (i == 0) converted += '-- | '.repeat(table[0].length - 1) + ' --\n';
		}
		
		return converted + '\n';
	}
	
	/** Get the index in this.uuids from an table object (which references another object which in turn has the UUID indice) */
	getTargetUuid(entry: number): string {
		let uuidIndex = this.objects[entry].customMap.mapEntry[0].value.unsignedIntegerValue;
		return this.uuids[uuidIndex];
	}
	
	uuidToString(uuid: Uint8Array): string {
		return Buffer.from(uuid).toString('hex');
	}
}
