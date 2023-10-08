import { 
	ANMergeableDataObject, ANMergeableObjectEntry,
	ANTableKey, ANTableType
} from './models';
import { NoteConverter } from './convert-note';
import { AppleNotesImporter } from '../apple-notes';

export class TableConverter {
	importer: AppleNotesImporter;
	table: ANMergeableDataObject;
	
	keys: string[];
	types: string[];
	uuids: string[];
	objects: ANMergeableObjectEntry[];
	
	rowCount: number;
	rowIndices: Record<number, number> = {};
	
	columnCount: number;
	columnIndices: Record<number, number> = {};
	
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
		const root = this.objects.find(e => e.customMap && this.types[e.customMap.type] == ANTableType.ICTable);
		if (!root) return null;
	
		let cellColumns: ANMergeableObjectEntry | null = null;
		
		for (const entry of root.customMap.mapEntry) {
			const object = this.objects[entry.value.objectIndex];
			
			switch (this.keys[entry.key]) {
				case ANTableKey.Rows:
					this.findIndices(object, true);
					break;
				case ANTableKey.Columns:
					this.findIndices(object, false);
					break;
				case ANTableKey.CellColumns:
					cellColumns = object;
					break;
			}
		}
		
		if (this.columnCount < 1 || this.rowCount < 1 || !cellColumns) return null;
		return await this.computeCells(cellColumns!);
	}
	
	findIndices(object: ANMergeableObjectEntry, rows: boolean): void {
		let count = 0;
		let indices = rows ? this.rowIndices : this.columnIndices;
		
		for (let attachment of object.orderedSet.ordering.array.attachment) {
			const uuidIndex = this.uuids.indexOf(this.uuidToString(attachment.uuid));
			indices[uuidIndex] = count;
			count++;
		}
		
		for (let element of object.orderedSet.ordering.contents.element) {
			let key = this.getTargetFromEntry(element.key.objectIndex);
			let value = this.getTargetFromEntry(element.value.objectIndex);
			
			indices[value] = indices[key];
		}
		
		if (rows) this.rowCount = count;
		else this.columnCount = count;
	}
	
	async computeCells(cellColumns: ANMergeableObjectEntry): Promise<string[][]> {
		//fill the array to the table dimensions
		let result = Array(this.rowCount).fill(0).map(() => Array(this.columnCount));
		
		//put the values in the table	
		for (let column of cellColumns!.dictionary.element) {
			let currentColumn = this.getTargetFromEntry(column.key.objectIndex);
			let targetDictionaryObject = this.objects[column.value.objectIndex];
			
			for (let row of targetDictionaryObject.dictionary.element) {
				let currentRow = this.getTargetFromEntry(row.key.objectIndex);
				let targetCell = this.objects[row.value.objectIndex];
				
				const converter = new NoteConverter(this.importer, targetCell.note);
				result[this.rowIndices[currentRow]][this.columnIndices[currentColumn]] = await converter.format(true); 
			}
		}
		
		return result;
	}
	
	async format(): Promise<string> {
		let table = await this.parse();
		let converted = '\n';
		
		if (!table) return '';
		
		for (let i = 0; i < table.length; i++) {
			converted += table[i].join(' | ') + '\n';
			if (i == 0) converted += '-- | '.repeat(table[0].length - 1) + ' --\n';
		}
		
		return converted + '\n';
	}
	
	getTargetFromEntry(entry: number): number {
		let object = this.objects[entry];
		return object.customMap.mapEntry[0].value.unsignedIntegerValue;
	}
	
	uuidToString(uuid: Uint8Array): string {
		return Buffer.from(uuid).toString('hex');
	}
}
