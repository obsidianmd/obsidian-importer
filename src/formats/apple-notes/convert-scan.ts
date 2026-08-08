import {
	ANContext,
	ANAttachment, ANConverter, ANMergeableDataObject, ANMergableDataProto, ANTableObject
} from './models';

export class ScanConverter extends ANConverter {
	scan: ANMergeableDataObject;
	objects: ANTableObject[];

	static protobufType = 'ciofecaforensics.MergableDataProto';

	constructor(ctx: ANContext, scan: ANMergableDataProto) {
		super(ctx);

		this.scan = scan.mergableDataObject;
		this.objects = this.scan.mergeableDataObjectData.mergeableDataObjectEntry;
	}

	async format(_table: boolean, parentNotePath: string): Promise<string> {
		const links = [];

		for (const object of this.objects) {
			if (!object.customMap) continue;
			const imageUuid = object.customMap.mapEntry[0].value.stringValue;

			const row = await this.ctx.database.get`
				SELECT z_pk, zmedia, ztypeuti FROM ziccloudsyncingobject
				WHERE zidentifier = ${imageUuid}`;

			if (!row) return '**Cannot decode scan**';

			// Try to get the nicely cropped version, but fallback to the raw image
			// if that fails. The cropped copy is often not on disk, so the first
			// attempt reports nothing: the page is lost only if both fail (#393).
			let file = await this.ctx.resolveAttachment(row.Z_PK, ANAttachment.Scan, true);
			if (!file) file = await this.ctx.resolveAttachment(row.ZMEDIA, row.ZTYPEUTI);

			if (file) {
				links.push('!' + this.ctx.linkTo(file, parentNotePath));
			}
			else {
				return '**Cannot decode scan**';
			}
		}

		return `\n${links.join('\n')}\n`;
	}
}
