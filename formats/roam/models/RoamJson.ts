import { PickedFile } from 'filesystem';

export interface RoamImportOptions {
    saveAttachments:Boolean,
	jsonSources: PickedFile[];
	outputDir: string,
	downloadAttachments:Boolean
}