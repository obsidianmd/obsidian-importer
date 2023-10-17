import { 
	ANAttachment, ANConverter, ANMergeableDataObject, ANMergableDataProto, ANTableObject
} from './models';
import { AppleNotesImporter } from '../apple-notes';

export class ScanConverter extends ANConverter {
	scan: ANMergeableDataObject;
	objects: ANTableObject[];
	
	static protobufType = 'ciofecaforensics.MergableDataProto';
	
	constructor(importer: AppleNotesImporter, scan: ANMergableDataProto) {
		super(importer);
		
		this.scan = scan.mergableDataObject;
		this.objects = this.scan.mergeableDataObjectData.mergeableDataObjectEntry;
	}	
	
	async format(): Promise<string> {
		const links = [];
		
		for (const object of this.objects) {
			if (!object.customMap) continue;
			const imageUuid = object.customMap.mapEntry[0].value.stringValue;
			
			const row = await this.importer.database.get`
				SELECT z_pk FROM ziccloudsyncingobject 
				WHERE zidentifier = ${imageUuid}`;
			
			const file = await this.importer.resolveAttachment(row.Z_PK, ANAttachment.Scan);
			links.push(this.importer.app.fileManager.generateMarkdownLink(file, '/'));
		}
		
		return `\n${links.join('\n')}\n`;
	}
}
