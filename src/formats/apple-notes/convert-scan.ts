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

	async format(_table: boolean, parentNotePath: string): Promise<string> {
		const links = [];

		for (const object of this.objects) {
			if (!object.customMap) continue;
			const imageUuid = object.customMap.mapEntry[0].value.stringValue;

			const row = await this.importer.database.get`
				SELECT z_pk, zmedia, ztypeuti FROM ziccloudsyncingobject 
				WHERE zidentifier = ${imageUuid}`;

			// Try to get the nicely cropped version, but fallback to the raw image if that fails
			let file = await this.importer.resolveAttachment(row.Z_PK, ANAttachment.Scan);
			if (!file) file = await this.importer.resolveAttachment(row.ZMEDIA, row.ZTYPEUTI);

			if (file) {
				links.push(this.importer.app.fileManager.generateMarkdownLink(file!, parentNotePath));
			}
			else {
				return '**Cannot decode scan**';
			}
		}

		return `\n${links.join('\n')}\n`;
	}
}
