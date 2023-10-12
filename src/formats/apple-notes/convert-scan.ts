import { TFile } from 'obsidian';
import { 
	ANAttachment, ANMergeableDataObject, ANTableObject
} from './models';
import { AppleNotesImporter } from '../apple-notes';

export class ScanConverter {
	importer: AppleNotesImporter;
	scan: ANMergeableDataObject;

	objects: ANTableObject[];
	
	constructor(importer: AppleNotesImporter, scan: ANMergeableDataObject) {
		this.importer = importer;
		this.scan = scan;
		
		this.objects = scan.mergeableDataObjectData.mergeableDataObjectEntry;
	}	
	
	async format() {
		const links = [];
		
		for (const object of this.objects) {
			if (!object.customMap) continue;
			const imageUuid = object.customMap.mapEntry[0].value.stringValue;
			
			const row = await this.importer.database.get`
				SELECT z_pk FROM ziccloudsyncingobject 
				WHERE zidentifier = ${imageUuid}`;
			
			console.log(imageUuid, row.Z_PK);
				
			await this.importer.resolveAttachment(row.Z_PK, ANAttachment.Scan);
			
			links.push(this.importer.app.fileManager.generateMarkdownLink(
				this.importer.resolvedFiles[row.Z_PK] as TFile, '/'
			));
		}
		
		return `\n${links.join('\n')}\n`;
	}
}
